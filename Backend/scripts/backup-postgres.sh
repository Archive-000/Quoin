#!/bin/sh
set -eu
umask 077

interval=${BACKUP_INTERVAL_SECONDS:-86400}
retention=${BACKUP_RETENTION_DAYS:-7}
for value in "$interval" "$retention"; do
  case "$value" in
    ''|*[!0-9]*) echo 'Backup interval and retention must be positive integers' >&2; exit 2 ;;
  esac
  if ! [ "$value" -gt 0 ]; then
    echo 'Backup interval and retention must be positive integers' >&2
    exit 2
  fi
done

while :; do
  filename="/backups/postgres-$(date -u +%Y%m%dT%H%M%SZ).dump"
  temp=$(mktemp /backups/.postgres-XXXXXX)
  trap 'rm -f "$temp"; exit 0' INT TERM HUP
  if pg_dump --no-password --format=custom --file="$temp" &&
     pg_restore --list "$temp" >/dev/null &&
     mv "$temp" "$filename"; then
    echo "Database backup complete: $filename"
    find /backups -type f -name 'postgres-*.dump' -mtime "+$((retention - 1))" -exec rm -f {} +
  else
    rm -f "$temp"
    echo 'Database backup failed' >&2
  fi
  sleep "$interval" &
  wait "$!"
done
