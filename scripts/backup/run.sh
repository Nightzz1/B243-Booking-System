#!/bin/sh
set -eu
umask 077
: "${PGHOST:?}" "${PGDATABASE:?}" "${PGUSER:?}" "${PGPASSWORD:?}" "${VERIFY_HOST:?}"
[ "$VERIFY_HOST" != "$PGHOST" ] || { echo 'Verification host must be isolated from production' >&2; exit 1; }
retention=${BACKUP_RETENTION_DAYS:-14}
case "$retention" in ''|*[!0-9]*) exit 1;; esac
[ "$retention" -ge 1 ] && [ "$retention" -le 3650 ]
mkdir -p /backups
# flock is provided by the postgres image's util-linux package.
exec 9>/backups/.backup.lock
flock -n 9 || { echo 'Another backup is running' >&2; exit 1; }
stamp=$(date -u +%Y%m%dT%H%M%SZ)
file="/backups/booking-${stamp}.dump"
tmp="${file}.partial"
cleanup() {
  rm -f "$tmp"
}
trap cleanup EXIT
trap 'exit 1' INT TERM
printf '%s backup started\n' "$stamp"
pg_dump --lock-wait-timeout=60s --format=custom --no-owner --no-acl --file="$tmp"
# Retain complete dumps even if the isolated restore test fails.
mv "$tmp" "$file"
sha256sum "$file" > "${file}.sha256"
sh /scripts/verify.sh "$(basename "$file")"
date -u +%s > /backups/.last-success.tmp
mv /backups/.last-success.tmp /backups/.last-success
# Only rotate after a new backup has passed restore verification.
find /backups -maxdepth 1 -type f -name 'booking-*.dump*' -mtime +"$retention" -exec rm -f {} \;
printf '%s backup and restore verification succeeded\n' "$stamp"
