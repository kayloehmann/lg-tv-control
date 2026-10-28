#!/bin/sh
set -eu

dashboard_url="${LG_TV_DASHBOARD_URL:-http://192.168.1.10:3083/}"

dashboard=/volume1/docker/dashboards/index.html
expected=96f850f03b6fc5268f1e9c7752a5b2a04f43470753f93fb6f99a32b71b3b9f4b
backup=/volume1/docker/dashboards/index.html.pre-lg-tv-20261025
staging=$(mktemp /tmp/lg-tv-dashboard.XXXXXX)
trap 'rm -f "$staging"' EXIT

actual=$(sha256sum "$dashboard" | awk '{print $1}')
if [ "$actual" != "$expected" ]; then
  echo "Dashboard wurde zwischenzeitlich geändert; Abbruch." >&2
  exit 1
fi

sed \
  -e 's#<h2>Infrastruktur</h2> <span>4</span>#<h2>Infrastruktur</h2> <span>5</span>#' \
  -e "s#</a> </div> </section> </div> <footer#</a><a class=\"dashboard-card dashboard-card--infrastructure\" href=\"${dashboard_url}\" target=\"_blank\" rel=\"noopener\"> <span class=\"dashboard-card__topline\"> <span class=\"dashboard-card__icon\" aria-hidden=\"true\">📺</span> <span class=\"dashboard-card__live\"><span aria-hidden=\"true\"></span>Live</span> </span> <span class=\"dashboard-card__content\"> <strong>LG TV Control</strong> <span>Einstellungen und technische Live-Informationen des LG webOS TV verwalten.</span> </span> <span class=\"dashboard-card__action\"> TV-Steuerung öffnen<span aria-hidden=\"true\">↗</span> </span> </a> </div> </section> </div> <footer#" \
  "$dashboard" > "$staging"

grep -q '<h2>Infrastruktur</h2> <span>5</span>' "$staging"
test "$(grep -F -o "href=\"${dashboard_url}\"" "$staging" | wc -l | tr -d ' ')" = 1

sudo -n install -m 0644 "$dashboard" "$backup"
sudo -n install -m 0644 "$staging" "$dashboard"
sha256sum "$dashboard"
