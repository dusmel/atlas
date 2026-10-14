#!/usr/bin/env bash
# Drives a throwaway local Atlas web instance for verification.
# Usage: verify-atlas.sh <launch|doctor|login|token|api|cli|shot|cleanup> [args]
# State lives in $VERIFY_DIR (default /tmp/verify-atlas-$USER). Evidence goes wherever the caller says.
set -euo pipefail

ROOT=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
DIR=${VERIFY_DIR:-/tmp/verify-atlas-$USER}
PASSWORD=verify-atlas-only

port() { cat "$DIR/port"; }
url() { echo "http://127.0.0.1:$(port)"; }
die() { echo "verify-atlas: $*" >&2; exit 1; }

launch() {
  [ -f "$DIR/pid" ] && kill -0 "$(cat "$DIR/pid")" 2>/dev/null && die "an instance is already running (pid $(cat "$DIR/pid")); run cleanup first"
  local p=${1:-3917}
  lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 && die "port $p is taken; pass another: launch <port>"
  mkdir -p "$DIR/data"
  echo "$p" > "$DIR/port"
  (cd "$ROOT" && bun run build:web >"$DIR/build.log" 2>&1) || die "build failed, see $DIR/build.log"
  local hash
  hash=$(bun -e "console.log(Buffer.from(await Bun.password.hash('$PASSWORD')).toString('base64'))")
  PORT=$p ATLAS_DATA_DIR="$DIR/data" ATLAS_PASSWORD_HASH_B64=$hash \
    nohup bun "$ROOT/apps/web/server.ts" >"$DIR/server.log" 2>&1 &
  echo $! > "$DIR/pid"
  for _ in $(seq 1 50); do
    curl -fs "$(url)/api/health" >/dev/null 2>&1 && { echo "ready at $(url) (pid $(cat "$DIR/pid"))"; return; }
    sleep 0.2
  done
  die "not ready after 10s, see $DIR/server.log"
}

doctor() {
  [ -f "$DIR/pid" ] || die "no instance started by this skill (no $DIR/pid)"
  local pid; pid=$(cat "$DIR/pid")
  kill -0 "$pid" 2>/dev/null || die "pid $pid is not running"
  local owner; owner=$(lsof -nP -t -iTCP:"$(port)" -sTCP:LISTEN 2>/dev/null | head -1)
  [ "$owner" = "$pid" ] || die "port $(port) is owned by pid ${owner:-none}, not $pid"
  local health; health=$(curl -fs "$(url)/api/health") || die "health check failed"
  echo "pid $pid owns $(url); data $DIR/data; health $health; HEAD $(git -C "$ROOT" rev-parse --short HEAD)"
}

login() {
  curl -fs -o /dev/null -c "$DIR/cookies" -X POST "$(url)/login" --data-urlencode "password=$PASSWORD" \
    -w "login: HTTP %{http_code} -> %{redirect_url}\n"
}

token() {
  [ -f "$DIR/cookies" ] || login >/dev/null
  curl -fs -b "$DIR/cookies" -H 'content-type: application/json' -H 'x-atlas: 1' \
    -d "{\"name\":\"verify-$(date +%s)\"}" "$(url)/api/tokens" | jq -r .token > "$DIR/token"
  echo "token saved to $DIR/token"
}

# api <METHOD> <path> [json-body]: bearer-token request; prints status line then body.
api() {
  [ -f "$DIR/token" ] || token >/dev/null
  local args=(-s -w '\nHTTP %{http_code}\n' -X "$1" -H "authorization: Bearer $(cat "$DIR/token")")
  [ $# -ge 3 ] && args+=(-H 'content-type: application/json' -d "$3")
  curl "${args[@]}" "$(url)$2"
}

# cli <atlas args...>: runs the atlas CLI from source against this instance.
cli() {
  [ -f "$DIR/token" ] || token >/dev/null
  ATLAS_URL=$(url) ATLAS_TOKEN=$(cat "$DIR/token") bun "$ROOT/apps/cli/index.ts" "$@"
}

# shot <path> <out.png> [width]: logged-in screenshot; prints the final URL and the page's scrollWidth.
shot() {
  [ -f "$DIR/cookies" ] || login >/dev/null
  local sid; sid=$(awk '$6=="atlas_session"{print $7}' "$DIR/cookies")
  [ -n "$sid" ] || die "no session cookie; run login"
  bun "$(dirname "$0")/shot.ts" "$(url)" "$1" "$sid" "$2" "${3:-1280}"
}

cleanup() {
  if [ -f "$DIR/pid" ]; then
    local pid; pid=$(cat "$DIR/pid")
    kill "$pid" 2>/dev/null && echo "stopped pid $pid" || echo "pid $pid was not running"
  fi
  rm -rf "$DIR"
  echo "removed $DIR"
}

cmd=${1:-}; shift || true
case "$cmd" in
  launch|doctor|login|token|api|cli|shot|cleanup) "$cmd" "$@" ;;
  *) sed -n 2,4p "$0"; exit 2 ;;
esac
