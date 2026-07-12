#!/bin/sh
set -eu

marker="${BACKUP_DIR:-/backups}/.last_success"
max_age="${BACKUP_MAX_AGE_SECONDS:-172800}"

case "$max_age" in
  ''|*[!0-9]*|0) exit 1 ;;
esac
[ -s "$marker" ] || exit 1

last_success="$(cat "$marker")"
case "$last_success" in
  ''|*[!0-9]*) exit 1 ;;
esac

age="$(( $(date +%s) - last_success ))"
[ "$age" -ge 0 ] && [ "$age" -le "$max_age" ]
