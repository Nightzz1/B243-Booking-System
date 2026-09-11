#!/bin/sh
set -eu
interval=${BACKUP_INTERVAL_SECONDS:-86400}
case "$interval" in ''|*[!0-9]*) exit 1;; esac
[ "$interval" -ge 3600 ] && [ "$interval" -le 604800 ]
trap 'exit 0' TERM INT
while :; do
  if ! sh /scripts/run.sh; then
    echo 'BACKUP FAILED: inspect logs; previous verified backups retained' >&2
  fi
  sleep "$interval" &
  wait $! || true
done
