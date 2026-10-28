#!/bin/sh
set -eu

if test "${I_UNDERSTAND:-}" != "YES"; then
  echo "Abbruch: Dieser Legacy-Fallback verändert die EIM-Konfiguration des TVs." >&2
  echo "Erst Diagnose und Backup durchführen; danach mit I_UNDERSTAND=YES erneut starten." >&2
  exit 2
fi

: "${TV_HOST:?TV_HOST fehlt}"
: "${TV_SSH_KEY_PATH:?TV_SSH_KEY_PATH fehlt}"
: "${TV_KNOWN_HOSTS_PATH:?TV_KNOWN_HOSTS_PATH fehlt}"

TV_SSH_USER="${TV_SSH_USER:-root}"
TV_SSH_PORT="${TV_SSH_PORT:-22}"
RELEASE_URL="https://github.com/speed47/webosbrew-autostart/releases/download/v1.0.4/org.webosbrew.autostart_0.1.4_all-704f0ae-autoclose.zip"
RELEASE_SHA256="f90718616ac47bfb6b694e5d01d8edfb61edfe2ef5fea268408717d3f38fc0e9"
REMOTE_IPK="/tmp/org.webosbrew.autostart_0.1.4_all.ipk"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/lg-webos-autostart.XXXXXX")"
ZIP_PATH="$WORK_DIR/autostart.zip"
IPK_PATH="$WORK_DIR/org.webosbrew.autostart_0.1.4_all.ipk"

cleanup() {
  rm -rf -- "$WORK_DIR"
}
trap cleanup EXIT HUP INT TERM

ssh_base() {
  ssh \
    -p "$TV_SSH_PORT" \
    -i "$TV_SSH_KEY_PATH" \
    -o BatchMode=yes \
    -o ConnectTimeout=8 \
    -o UserKnownHostsFile="$TV_KNOWN_HOSTS_PATH" \
    -o StrictHostKeyChecking=yes \
    -o HostKeyAlgorithms=ssh-ed25519 \
    "$TV_SSH_USER@$TV_HOST" "$@"
}

ssh_tty() {
  ssh \
    -tt \
    -p "$TV_SSH_PORT" \
    -i "$TV_SSH_KEY_PATH" \
    -o BatchMode=yes \
    -o ConnectTimeout=8 \
    -o UserKnownHostsFile="$TV_KNOWN_HOSTS_PATH" \
    -o StrictHostKeyChecking=yes \
    -o HostKeyAlgorithms=ssh-ed25519 \
    "$TV_SSH_USER@$TV_HOST" "$@"
}

echo "Lade gepinnten Fallback v0.1.4 ..."
curl -fL --retry 3 -o "$ZIP_PATH" "$RELEASE_URL"

if command -v shasum >/dev/null 2>&1; then
  actual_sha="$(shasum -a 256 "$ZIP_PATH" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  actual_sha="$(sha256sum "$ZIP_PATH" | awk '{print $1}')"
else
  echo "Abbruch: Weder shasum noch sha256sum ist installiert." >&2
  exit 1
fi
if test "$actual_sha" != "$RELEASE_SHA256"; then
  echo "Abbruch: SHA-256 stimmt nicht überein." >&2
  exit 1
fi

unzip -q "$ZIP_PATH" -d "$WORK_DIR"
test -f "$IPK_PATH"

echo "Prüfe TV-Zustand ..."
ssh_base 'test -x /var/lib/webosbrew/startup.sh && test -e /var/luna/preferences/webosbrew_sshd_enabled'

echo "Übertrage und installiere Fallback ..."
scp \
  -O \
  -P "$TV_SSH_PORT" \
  -i "$TV_SSH_KEY_PATH" \
  -o BatchMode=yes \
  -o UserKnownHostsFile="$TV_KNOWN_HOSTS_PATH" \
  -o StrictHostKeyChecking=yes \
  -o HostKeyAlgorithms=ssh-ed25519 \
  "$IPK_PATH" "$TV_SSH_USER@$TV_HOST:$REMOTE_IPK"

ssh_tty "luna-send -P -i -a webosbrew luna://com.webos.appInstallService/dev/install '{\"id\":\"com.ares.defaultName\",\"ipkUrl\":\"$REMOTE_IPK\",\"subscribe\":true}' | awk '/\"state\":\"installed\"/{print; exit} {print}'"

echo "Sichere und konfiguriere EIM ..."
ssh_base 'sh -s' <<'REMOTE'
set -eu

if findmnt /var/lib/eim 2>/dev/null | grep -q '/var/lib/webosbrew/eim'; then
  echo "EIM-Fallback ist bereits aktiv; keine Änderung notwendig."
  exit 0
fi

timestamp="$(date +%Y%m%d-%H%M%S)"
backup="/var/lib/webosbrew/eim.backup-$timestamp"

test -d /var/lib/eim
test ! -e "$backup"
cp -a /var/lib/eim "$backup"
echo "backup=$backup"

luna-send -P -f -n 1 -w 5000 \
  luna://com.webos.service.eim/deleteDevice \
  '{"appId":"org.webosbrew.autostart"}'

luna-send -P -f -n 1 -w 5000 \
  luna://com.webos.service.eim/addDevice \
  '{"appId":"org.webosbrew.autostart","pigImage":"","mvpdIcon":"","type":"MVPD_IP","label":"Autostart","description":"webosbrew autostart"}'

if test ! -d /var/lib/webosbrew/eim; then
  mkdir /var/lib/webosbrew/eim
  cp -a /var/lib/eim/. /var/lib/webosbrew/eim/
fi

mount --bind /var/lib/webosbrew/eim /var/lib/eim

luna-send -P -f -n 1 -w 5000 \
  luna://com.webos.service.eim/deleteDevice \
  '{"appId":"org.webosbrew.autostart"}'

sync
findmnt /var/lib/eim
echo "Fallback eingerichtet. Sicherung nicht löschen: $backup"
REMOTE

echo "Fertig. Jetzt einen echten Systemneustart durchführen und zweimal ohne Öffnen des Homebrew Channels prüfen."
