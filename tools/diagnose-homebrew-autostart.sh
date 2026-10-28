#!/bin/sh
set -eu

: "${TV_HOST:?TV_HOST fehlt}"
: "${TV_SSH_KEY_PATH:?TV_SSH_KEY_PATH fehlt}"
: "${TV_KNOWN_HOSTS_PATH:?TV_KNOWN_HOSTS_PATH fehlt}"

TV_SSH_USER="${TV_SSH_USER:-root}"
TV_SSH_PORT="${TV_SSH_PORT:-22}"

ssh \
  -tt \
  -p "$TV_SSH_PORT" \
  -i "$TV_SSH_KEY_PATH" \
  -o BatchMode=yes \
  -o ConnectTimeout=8 \
  -o UserKnownHostsFile="$TV_KNOWN_HOSTS_PATH" \
  -o StrictHostKeyChecking=yes \
  -o HostKeyAlgorithms=ssh-ed25519 \
  "$TV_SSH_USER@$TV_HOST" 'sh -s' <<'REMOTE'
set -u

echo "== System =="
date
uptime
cat /proc/uptime 2>/dev/null || true

echo "== Homebrew =="
if test -f /media/developer/apps/usr/palm/applications/org.webosbrew.hbchannel/appinfo.json; then
  sed -n '1,80p' /media/developer/apps/usr/palm/applications/org.webosbrew.hbchannel/appinfo.json
else
  echo "Homebrew Channel appinfo.json fehlt"
fi

echo "== Startup marker =="
if test -e /tmp/webosbrew_startup; then
  stat -c '%y %n' /tmp/webosbrew_startup 2>/dev/null || ls -l /tmp/webosbrew_startup
else
  echo "marker=missing"
fi

echo "== SSH listener =="
netstat -an 2>/dev/null | grep -E '(^|[.:])22[[:space:]]' || echo "port22=not-listening"

echo "== Dropbear =="
found_dropbear=0
for proc in /proc/[0-9]*; do
  command_line="$(tr '\000' ' ' < "$proc/cmdline" 2>/dev/null || true)"
  case "$command_line" in
    *bin/dropbear*)
      echo "pid=${proc##*/} $command_line"
      found_dropbear=1
      ;;
  esac
done
test "$found_dropbear" -eq 1 || echo "dropbear=missing"

echo "== Failsafe =="
if test -e /var/luna/preferences/webosbrew_failsafe; then
  echo "failsafe=present"
else
  echo "failsafe=absent"
fi

echo "== Persistent hooks =="
find \
  /media/cryptofs/apps/usr/palm/services/com.palmdts.devmode.service \
  /media/developer/apps/usr/palm/services/com.palmdts.devmode.service \
  -maxdepth 1 -type f -name 'start-devmode*' -print 2>/dev/null || true

echo "== EIM fallback =="
if test -f /media/developer/apps/usr/palm/applications/org.webosbrew.autostart/appinfo.json; then
  echo "autostart_app=installed"
  cat /media/developer/apps/usr/palm/applications/org.webosbrew.autostart/appinfo.json
else
  echo "autostart_app=not-installed"
fi
findmnt /var/lib/eim 2>/dev/null || echo "eim_overlay=not-mounted"

echo "== Homebrew activity =="
luna-send -f -a webosbrew -n 1 -w 5000 \
  luna://com.webos.service.activitymanager/info '{}' 2>/dev/null \
  | grep -A4 -B2 'org.webosbrew.hbchannel.service.autostart' \
  || echo "activity=not-visible"
REMOTE
