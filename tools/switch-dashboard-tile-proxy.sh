#!/bin/sh
set -eu

dashboard=/volume1/docker/dashboards/index.html
expected=b8f9e200fdf290f8de30aa72ea3b72e85cb3b199d5ab3ec41dfa1fa56b70a12a
backup=/volume1/docker/dashboards/index.html.pre-lg-tv-proxy-20261025
staging=$(mktemp /tmp/lg-tv-dashboard-proxy.XXXXXX)
trap 'rm -f "$staging"' EXIT

actual=$(sha256sum "$dashboard" | awk '{print $1}')
if [ "$actual" != "$expected" ]; then
  echo "Dashboard wurde zwischenzeitlich geändert; Abbruch." >&2
  exit 1
fi

sed 's#href="http://10.111.0.104:3083/"#href="/lg-tv/"#' "$dashboard" > "$staging"
test "$(grep -o 'href="/lg-tv/"' "$staging" | wc -l | tr -d ' ')" = 1

sudo -n install -m 0644 "$dashboard" "$backup"
sudo -n install -m 0644 "$staging" "$dashboard"
sha256sum "$dashboard"
