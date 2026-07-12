#!/bin/sh
set -eu

archive="${1:-}"
target_database="${2:-${RESTORE_DATABASE:-}}"
lock_stale_seconds="${BACKUP_LOCK_STALE_SECONDS:-21600}"

if [ -z "$archive" ] || [ -z "$target_database" ]; then
  echo "Usage: stemegle-restore /backups/FILE.dump TARGET_DATABASE" >&2
  echo "Set RESTORE_CONFIRM=restore:TARGET_DATABASE to authorize replacement." >&2
  exit 2
fi
if [ ! -f "$archive" ]; then
  echo "Backup archive does not exist: $archive" >&2
  exit 1
fi
case "$target_database" in
  ''|*[!A-Za-z0-9_]*) echo "Target database must contain only letters, numbers, and underscores" >&2; exit 1 ;;
  postgres|template0|template1) echo "Refusing to replace a PostgreSQL system database" >&2; exit 1 ;;
esac
if [ "${RESTORE_CONFIRM:-}" != "restore:$target_database" ]; then
  echo "Restore not authorized. Set RESTORE_CONFIRM=restore:$target_database" >&2
  exit 1
fi
case "$lock_stale_seconds" in
  ''|*[!0-9]*|0) echo "BACKUP_LOCK_STALE_SECONDS must be a positive integer" >&2; exit 1 ;;
esac

backup_dir="${BACKUP_DIR:-/backups}"
mkdir -p "$backup_dir"
lock_dir="$backup_dir/.postgres-operation.lock"
if ! mkdir "$lock_dir" 2>/dev/null; then
  lock_created="$(cat "$lock_dir/created_at" 2>/dev/null || echo 0)"
  case "$lock_created" in ''|*[!0-9]*) lock_created=0 ;; esac
  lock_age="$(( $(date +%s) - lock_created ))"
  if [ "$lock_age" -lt "$lock_stale_seconds" ]; then
    echo "Another backup or restore operation is already running" >&2
    exit 1
  fi
  rm -f "$lock_dir/created_at"
  rmdir "$lock_dir" 2>/dev/null || {
    echo "Stale operation lock could not be cleared" >&2
    exit 1
  }
  mkdir "$lock_dir"
fi
date +%s > "$lock_dir/created_at"
restore_complete=1
target_created=0
cleanup() {
  if [ "$restore_complete" -eq 0 ] && [ "$target_created" -eq 1 ]; then
    dropdb --maintenance-db=postgres --if-exists --force "$target_database" >/dev/null 2>&1 || true
  fi
  rm -f "$lock_dir/created_at"
  rmdir "$lock_dir" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

checksum="${archive}.sha256"
if [ ! -f "$checksum" ]; then
  echo "Checksum file is required: $checksum" >&2
  exit 1
fi
(
  cd "$(dirname "$archive")"
  sha256sum -c "$(basename "$checksum")"
)
pg_restore --list "$archive" >/dev/null

if [ "$target_database" = "${PGDATABASE:-}" ] && [ "${RESTORE_SKIP_SAFETY_BACKUP:-0}" != "1" ]; then
  echo "Creating a verified safety backup before replacing $target_database"
  BACKUP_LOCK_HELD=1 BACKUP_SKIP_RETENTION=1 /usr/local/bin/stemegle-backup
fi

restore_complete=0
echo "Replacing database $target_database from $(basename "$archive")"
dropdb --maintenance-db=postgres --if-exists --force "$target_database"
createdb --maintenance-db=postgres --template=template0 "$target_database"
target_created=1
pg_restore \
  --exit-on-error \
  --no-owner \
  --no-acl \
  --dbname="$target_database" \
  "$archive"
psql --no-psqlrc --dbname="$target_database" --set=ON_ERROR_STOP=1 --tuples-only --command='select 1' >/dev/null

restore_complete=1
target_created=0
rm -f "$lock_dir/created_at"
rmdir "$lock_dir"
trap - EXIT HUP INT TERM
echo "Restore into $target_database completed successfully"
