#!/bin/sh
# One-way: pulls MEGA into /data/docs and copies backups up. Never writes to the repos folder in MEGA.
# Each step is skipped until its path is set in Coolify and rclone.conf exists (runbook R5).
mkdir -p /data/docs /data/state
status() { echo "{\"state\":\"$1\",\"at\":\"$(date -u +%FT%TZ)\"}" > /data/state/last-pull.json; }

while true; do
  if [ ! -f /config/rclone/rclone.conf ]; then
    status "no-config"
  else
    if [ -n "$MEGA_REPOS_PATH" ] && [ ! -f /data/state/mega-hold ]; then
      status running
      if rclone sync "mega:$MEGA_REPOS_PATH" /data/docs --exclude .DS_Store --log-level INFO; then status ok; else status failed; fi
    fi
    if [ -n "$MEGA_BACKUPS_PATH" ]; then
      rclone copy /data/backups "mega:$MEGA_BACKUPS_PATH" --log-level INFO || true
    fi
  fi
  rm -f /data/state/pull-now
  i=0
  while [ $i -lt 60 ] && [ ! -f /data/state/pull-now ]; do sleep 2; i=$((i + 1)); done
done
