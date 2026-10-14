#!/bin/sh
# Runs MEGAcmd, plus a loop that tells the web app how the sync pairs are doing (spec section 9).
# The containers share /data/state: this writes mega-sync.txt every 30 s, touches mega-synced when
# every pair is synced, and answers the web's mega-pull file with mega-reload within 5 s.
state=/data/state

report() {
  mega-sync --col-separator='|' --output-cols=LOCALPATH,RUN_STATE,STATUS,ERROR >"$state/mega-sync.tmp" 2>&1
  mv "$state/mega-sync.tmp" "$state/mega-sync.txt"
  pairs=$(tail -n +2 "$state/mega-sync.txt" | grep -c '|')
  synced=$(grep -c '|Running|Synced|NO$' "$state/mega-sync.txt")
  if [ "$pairs" -gt 0 ] && [ "$pairs" -eq "$synced" ]; then touch "$state/mega-synced"; fi
}

loop() {
  # A mega-* command starts its own server when none answers, so give this one time to start.
  sleep 15
  n=0
  while :; do
    if [ -e "$state/mega-pull" ]; then
      rm -f "$state/mega-pull"
      mega-reload >/dev/null 2>&1
      n=0
    fi
    if [ $((n % 6)) -eq 0 ]; then report; fi
    n=$((n + 1))
    sleep 5
  done
}

loop &
exec mega-cmd-server
