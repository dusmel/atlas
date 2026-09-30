---
name: verify-atlas
description: "Launch a throwaway local Atlas web server (apps/web) and prove behavior the way a user reaches it: the login page, API tokens, the todo API, and the `atlas todo` CLI, with screenshots at desktop and phone width. Use to verify any change to apps/web or apps/cli/src/todo before opening a PR, or when asked to prove Atlas web works."
---

# Verify Atlas

Atlas web is a TanStack Start app served by `apps/web/server.ts` over a SQLite file. Users reach it three ways: pages in a browser (`/login`, `/`, `/settings`), the JSON API under `/api/` with a bearer token, and the `atlas todo` CLI, which is a client of that API. This skill starts a private instance with its own data folder and a known throwaway password, drives those paths, and tears the instance down.

Every step goes through `.claude/skills/verify-atlas/verify-atlas.sh` (below: `$H`), run from the repo root. It keeps its state in `$VERIFY_DIR`, default `/tmp/verify-atlas-$USER`. Set `VERIFY_DIR` to a unique path to run two instances side by side, and pass each a different port.

Never drive the production instance at `atlas.hadadus.me`, and never point `ATLAS_URL` at it from this skill. It holds real todos.

## Launch

```sh
H=.claude/skills/verify-atlas/verify-atlas.sh
$H launch [port]        # default port 3917
```

`launch` refuses to start when the port is taken or an instance from this `VERIFY_DIR` is still running. It builds the web app (`bun run build:web`, log in `$VERIFY_DIR/build.log`), hashes the throwaway password `verify-atlas-only` with argon2id, and starts `bun apps/web/server.ts` with `PORT`, `ATLAS_DATA_DIR=$VERIFY_DIR/data` and `ATLAS_PASSWORD_HASH_B64`. It is ready when it prints `ready at http://127.0.0.1:<port> (pid <pid>)`, which happens once `GET /api/health` answers 200. Server output goes to `$VERIFY_DIR/server.log`.

The first request opens the database and applies `apps/web/migrations/*.sql` to the empty data folder, so every run starts with no todos and one repo, `personal`.

## Doctor

```sh
$H doctor
```

Read-only. Passes only when the pid in `$VERIFY_DIR/pid` is alive, that same pid owns the port, and `/api/health` returns `{"ok":true,...,"db":"ok"}`. It prints the version from health next to `git rev-parse --short HEAD`. They match unless the build is stale, in which case run cleanup and launch again. Run doctor first whenever anything looks off.

## Drive

| command | what it does |
|---|---|
| `$H login` | `POST /login` with the password; saves the `atlas_session` cookie to `$VERIFY_DIR/cookies`. Prints `login: HTTP 303 -> .../` on success. |
| `$H token` | logs in if needed, then `POST /api/tokens` with the cookie and `X-Atlas: 1`, the same call the Settings page makes. Saves the token to `$VERIFY_DIR/token`. |
| `$H api <METHOD> <path> [json]` | bearer-token request; prints the body, then `HTTP <code>`. |
| `$H cli <args>` | runs `bun apps/cli/index.ts <args>` with `ATLAS_URL` and `ATLAS_TOKEN` set to this instance. |
| `$H shot <path> <out.png> [width]` | logged-in screenshot through headless Chrome (`shot.ts`). Prints JSON with the final URL and `scrollWidth`. |

Run `cli` from the repo root. A bare `atlas todo add` there sends the repo as `{id, name}` from git, so the server creates the `atlas` repo on first use. `--repo NAME` sends a bare name, which must already exist on the server, and fails with `No repo NAME` on a fresh instance.

`shot` cannot click. For a UI change, drive the action through the same HTTP call the page makes (`api` or the cookie), then screenshot the page to show the result. At width 600 and below, `shot` emulates a phone. A `scrollWidth` larger than the width means the page scrolls sideways.

The feature map in `features/README.md` lists each feature, its entry points, and the exact commands.

## Evidence

Write evidence where the caller says. In a /mel effort that is `atlas/<effort>/evidence/<phase>/`. Otherwise use a folder outside `$VERIFY_DIR`, because cleanup deletes `$VERIFY_DIR`.

- Record `$H doctor` output first, so each proof names the build it ran against.
- CLI proof: the command, its stdout, and its exit code (`echo "exit=$?"`).
- API proof: the request and the printed `HTTP <code>` line with the body.
- Every change gets a second, read-only view. After `cli todo add`, read it back with `$H api GET '/api/todos?repo=atlas'`. After a UI action, take a screenshot.
- UI proof: a screenshot plus the JSON line from `shot`, at 1280 and at 390 when layout matters.
- Never save `$VERIFY_DIR/token` or `$VERIFY_DIR/cookies` as evidence. They are throwaway, but they look like secrets in a public repo.

## Cleanup

```sh
$H cleanup
lsof -nP -iTCP:<port> -sTCP:LISTEN || echo "nothing on <port>"
```

`cleanup` kills only the pid this skill started, then deletes `$VERIFY_DIR` (data, logs, cookies, token). It never touches evidence folders. Run it after every run, including failed ones.

## Helpers

- `verify-atlas.sh`: every command above. Run it with no arguments for usage.
- `shot.ts`: `bun shot.ts <base-url> <path> <session-id> <out.png> [width]`. Starts headless Chrome on a random DevTools port with a temporary profile, sets the session cookie, loads the page, and saves a full-page PNG. `verify-atlas.sh shot` calls it with the right session.

Requirements: `bun`, `jq`, `curl`, `lsof`, and Google Chrome at `/Applications/Google Chrome.app`. macOS only as written.
