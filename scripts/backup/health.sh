#!/bin/sh
set -eu
[ -f /backups/.last-success ]
last=$(cat /backups/.last-success)
now=$(date -u +%s)
[ "$((now - last))" -lt "$((${BACKUP_INTERVAL_SECONDS:-86400} + 7200))" ]
