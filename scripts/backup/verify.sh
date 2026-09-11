#!/bin/sh
set -eu
umask 077
: "${PGHOST:?}" "${PGUSER:?}" "${PGPASSWORD:?}" "${VERIFY_HOST:?}"
[ "$VERIFY_HOST" != "$PGHOST" ] || { echo 'Verification host must be isolated from production' >&2; exit 1; }
name=${1:?Supply a backup filename}
case "$name" in booking-*.dump) ;; *) echo 'Invalid backup filename' >&2; exit 1;; esac
case "$name" in */*|*..*) exit 1;; esac
file="/backups/$name"
rm -f "${file}.verified"
sha256sum -c "${file}.sha256"
verify_db="verify_$(date -u +%Y%m%d%H%M%S)_$$"
cleanup() { PGHOST="$VERIFY_HOST" dropdb --if-exists "$verify_db" >/dev/null 2>&1 || true; }
trap cleanup EXIT
trap 'exit 1' INT TERM
PGHOST="$VERIFY_HOST" createdb --template=template0 "$verify_db"
PGHOST="$VERIFY_HOST" pg_restore --dbname="$verify_db" --no-owner --no-acl --exit-on-error --single-transaction "$file"
PGHOST="$VERIFY_HOST" PGDATABASE="$verify_db" psql -X -v ON_ERROR_STOP=1 <<'SQL'
DO $$
BEGIN
  IF to_regclass('public.users') IS NULL OR to_regclass('public.bookings') IS NULL OR to_regclass('public.admin_audit_logs') IS NULL THEN
    RAISE EXCEPTION 'Required application tables missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_slot_practice_mode_exclusive') THEN
    RAISE EXCEPTION 'Booking exclusion constraint missing';
  END IF;
END $$;
SELECT count(*) AS users FROM users;
SELECT count(*) AS bookings FROM bookings;
SELECT count(*) AS audit_records FROM admin_audit_logs;
SQL
PGHOST="$VERIFY_HOST" dropdb "$verify_db"
printf '%s restore verified\n' "$(date -u +%Y%m%dT%H%M%SZ)" > "${file}.verified"
