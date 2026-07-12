#!/bin/sh
set -eu

interval="${BACKUP_INTERVAL_SECONDS:-86400}"
retry_interval="${BACKUP_RETRY_SECONDS:-900}"

case "$interval" in
  ''|*[!0-9]*|0) echo "BACKUP_INTERVAL_SECONDS must be a positive integer" >&2; exit 1 ;;
esac
case "$retry_interval" in
  ''|*[!0-9]*|0) echo "BACKUP_RETRY_SECONDS must be a positive integer" >&2; exit 1 ;;
esac

while :; do
  if /usr/local/bin/stemegle-backup; then
    delay="$interval"
  else
    echo "Backup failed; retrying in ${retry_interval}s" >&2
    delay="$retry_interval"
  fi
  sleep "$delay" &
  wait "$!"
done
