#!/bin/sh
set -eu

docker=/usr/local/bin/docker
container=lg-tv-control

if ! "$docker" inspect "$container" --format '{{.State.Running}}' 2>/dev/null | grep -qx true; then
  logger -p user.err -t lg-tv-backup "Sicherung fehlgeschlagen: Container lg-tv-control läuft nicht."
  exit 1
fi

if output=$("$docker" exec "$container" node /app/src/backup-cli.mjs 2>&1); then
  logger -p user.notice -t lg-tv-backup "$output"
else
  status=$?
  logger -p user.err -t lg-tv-backup "$output"
  exit "$status"
fi
