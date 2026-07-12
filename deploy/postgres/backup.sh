#!/bin/sh
set -eu

umask 077

backup_dir="${BACKUP_DIR:-/backups}"
retention_days="${BACKUP_RETENTION_DAYS:-30}"
verify_database="${BACKUP_VERIFY_DATABASE:-stemegle_backup_verify}"
lock_stale_seconds="${BACKUP_LOCK_STALE_SECONDS:-21600}"

case "$retention_days" in
  ''|*[!0-9]*) echo "BACKUP_RETENTION_DAYS must be a non-negative integer" >&2; exit 1 ;;
esac
case "$lock_stale_seconds" in
  ''|*[!0-9]*|0) echo "BACKUP_LOCK_STALE_SECONDS must be a positive integer" >&2; exit 1 ;;
esac
case "${PGDATABASE:-}" in
  ''|*[!A-Za-z0-9_]*) echo "PGDATABASE must contain only letters, numbers, and underscores" >&2; exit 1 ;;
esac
case "$verify_database" in
  ''|*[!A-Za-z0-9_]*) echo "BACKUP_VERIFY_DATABASE must contain only letters, numbers, and underscores" >&2; exit 1 ;;
esac
if [ "$verify_database" = "$PGDATABASE" ]; then
  echo "BACKUP_VERIFY_DATABASE must differ from PGDATABASE" >&2
  exit 1
fi

mkdir -p "$backup_dir"
lock_dir="$backup_dir/.postgres-operation.lock"
lock_acquired=0
if [ "${BACKUP_LOCK_HELD:-0}" != "1" ]; then
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
  lock_acquired=1
fi
find "$backup_dir" -type f -name ".${PGDATABASE}_*.dump.tmp" -exec rm -f {} +
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
filename="${PGDATABASE}_${timestamp}.dump"
while [ -e "$backup_dir/$filename" ] || [ -e "$backup_dir/.${filename}.tmp" ]; do
  sleep 1
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  filename="${PGDATABASE}_${timestamp}.dump"
done
archive="$backup_dir/$filename"
temporary="$backup_dir/.${filename}.tmp"
checksum_temporary="$backup_dir/.${filename}.sha256.tmp"
verification_created=0

cleanup() {
  rm -f "$temporary" "$checksum_temporary"
  if [ "$verification_created" -eq 1 ]; then
    dropdb --maintenance-db=postgres --if-exists --force "$verify_database" >/dev/null 2>&1 || true
  fi
  if [ "$lock_acquired" -eq 1 ]; then
    rm -f "$lock_dir/created_at"
    rmdir "$lock_dir" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

echo "Creating PostgreSQL backup $filename"
pg_dump \
  --format=custom \
  --compress=6 \
  --no-owner \
  --no-acl \
  --file="$temporary" \
  "$PGDATABASE"

if [ ! -s "$temporary" ]; then
  echo "Backup archive is empty" >&2
  exit 1
fi
pg_restore --list "$temporary" >/dev/null

echo "Verifying $filename with a full scratch-database restore"
dropdb --maintenance-db=postgres --if-exists --force "$verify_database" >/dev/null
createdb --maintenance-db=postgres --template=template0 "$verify_database"
verification_created=1
pg_restore \
  --exit-on-error \
  --no-owner \
  --no-acl \
  --dbname="$verify_database" \
  "$temporary"
psql --no-psqlrc --dbname="$verify_database" --set=ON_ERROR_STOP=1 --tuples-only --command='select 1' >/dev/null
dropdb --maintenance-db=postgres --if-exists --force "$verify_database" >/dev/null
verification_created=0

mv "$temporary" "$archive"
(
  cd "$backup_dir"
  sha256sum "$filename" > ".${filename}.sha256.tmp"
  sha256sum -c ".${filename}.sha256.tmp" >/dev/null
  mv ".${filename}.sha256.tmp" "${filename}.sha256"
)

if [ "${BACKUP_SKIP_RETENTION:-0}" != "1" ]; then
  find "$backup_dir" -type f \
    \( -name "${PGDATABASE}_*.dump" -o -name "${PGDATABASE}_*.dump.sha256" \) \
    -mtime "+$retention_days" -exec rm -f {} +
fi

marker_tmp="$backup_dir/.last_success.tmp"
date +%s > "$marker_tmp"
mv "$marker_tmp" "$backup_dir/.last_success"

trap - EXIT HUP INT TERM
if [ "$lock_acquired" -eq 1 ]; then
  rm -f "$lock_dir/created_at"
  rmdir "$lock_dir"
fi
echo "Backup $filename created and restore-verified"
