# LG webOS Root, Homebrew und zuverlässiger SSH-Autostart

Diese Anleitung beschreibt den tatsächlich getesteten Aufbau für zwei gerootete LG-Fernseher, die anschließend über das NAS-Dashboard dieses Repositorys verwaltet werden. Sie trennt bewusst Rooting, SSH-Härtung und Autostart-Reparatur: Nicht jedes Gerät braucht dieselbe Reparatur.

## Getestete Geräte

| Rolle | Modell | Firmware | webOS / SDK | beobachteter Autostart |
| --- | --- | --- | --- | --- |
| Wohnzimmer | LG 55SK7900PLA | `06.10.65` | webOS 3.x | Homebrew Channel 0.7.3 registrierte eine Activity, sie wurde beim Boot aber nicht ausgelöst. Der EIM-Fallback 0.1.4 wurde benötigt. |
| Schlafzimmer | LG 43UM74507LA | `05.40.97` | webOS 4.5 / SDK `4.10.0` | Die persistente Homebrew-Activity funktionierte. SSH erschien rund eine Minute nach dem Boot; kein Fallback wurde installiert. |

Die Ergebnisse gelten nicht automatisch für andere Modell-/Firmwarekombinationen. Prüfe zuerst [CanI.RootMy.TV](https://cani.rootmy.tv/) und die [webOS Homebrew Rooting-Dokumentation](https://www.webosbrew.org/rooting/). Aktualisiere die TV-Firmware nicht, solange Root-Zugriff erhalten bleiben soll.

## Sicherheits- und Wiederherstellungsregeln

1. Automatische Firmware-Updates deaktivieren.
2. LGs Developer-Mode-App vor dem Rooting entfernen und auf einem gerooteten TV nicht erneut installieren.
3. Quick Start+ für reproduzierbare Kaltstarts deaktivieren.
4. Vor Änderungen eine vollständige Gerätesicherung erzeugen. Das Dashboard speichert sie mit SHA-256 und validiert den TAR-Inhalt.
5. SSH nur mit einem eigenen Schlüssel betreiben. Telnet nach der Einrichtung deaktivieren.
6. Niemals private Schlüssel, `authorized_keys`, TV-Backups, `.env`, Tokens oder `autoroot.log` committen.
7. Keine fremden `start-devmode.sh`-, Upstart- oder Systemd-Hooks blind kopieren. Eine falsche Signatur oder ein unpassender Hook kann Homebrew-Apps beim Boot entfernen.

## 1. Root-Zugang herstellen

Für den LG 55SK7900PLA mit Firmware `06.10.65` wurde `dejavuln-autoroot 0.0.10` verwendet. Die USB-Schritte stehen in [USB-INSTRUCTIONS.md](../USB-INSTRUCTIONS.md). Lade den Exploit ausschließlich vom [Originalprojekt](https://github.com/throwaway96/dejavuln-autoroot/releases).

Ein erfolgreicher Lauf muss mindestens Folgendes ergeben:

- Homebrew Channel ist als App sichtbar.
- `/var/luna/preferences/devmode_enabled` ist ein Verzeichnis.
- `/var/lib/webosbrew/startup.sh` ist vorhanden und ausführbar.
- Homebrew Channel meldet Root-Zugriff.

## 2. SSH absichern

Aktiviere SSH in den Root-Einstellungen des Homebrew Channels. Lege danach einen dedizierten Schlüssel an und übertrage nur den öffentlichen Schlüssel:

```sh
ssh-keygen -t ed25519 -f "$HOME/.ssh/lg-tv-root" -C lg-tv-control
ssh-keyscan -t ed25519 TV_IP >> "$HOME/.ssh/known_hosts"
ssh-copy-id -i "$HOME/.ssh/lg-tv-root.pub" root@TV_IP
```

Prüfe den Schlüsselzugang in einer zweiten Sitzung, bevor du Passwort- oder Telnet-Zugänge abschaltest:

```sh
ssh -i "$HOME/.ssh/lg-tv-root" \
  -o UserKnownHostsFile="$HOME/.ssh/known_hosts" \
  -o StrictHostKeyChecking=yes \
  root@TV_IP id
```

Erwartet wird `uid=0(root)`. Deaktiviere anschließend Telnet im Homebrew Channel. Die Präferenzdateien sollten dann unter anderem so aussehen:

```text
/var/luna/preferences/webosbrew_sshd_enabled
/var/luna/preferences/webosbrew_telnet_disabled
/var/luna/preferences/webosbrew_block_updates
```

## 3. Autostart zuerst nur diagnostizieren

Schalte den TV vollständig neu, öffne den Homebrew Channel nicht und warte bei webOS 4.5 mindestens 90 Sekunden. Prüfe dann:

```sh
TV_HOST=TV_IP \
TV_SSH_KEY_PATH="$HOME/.ssh/lg-tv-root" \
TV_KNOWN_HOSTS_PATH="$HOME/.ssh/known_hosts" \
./tools/diagnose-homebrew-autostart.sh
```

Wichtige Signale:

- Port 3000/3001 offen, Port 22 geschlossen: webOS läuft, Homebrew-Startup fehlt noch.
- `/tmp/webosbrew_startup` vorhanden: `startup.sh` lief in diesem Boot.
- Dropbear lauscht auf `0.0.0.0:22`/`:::22`: SSH wurde wirklich gestartet.
- `webosbrew_failsafe` verschwindet nach Abschluss: Startup ist sauber beendet.
- `org.webosbrew.hbchannel.service.autostart` im Activity Manager: persistente Homebrew-Activity ist registriert.

Auf dem getesteten webOS-4.5-Gerät erschien der Marker erst etwa eine Minute nach dem Boot. Das ist kein Fehler; dort wurde nichts zusätzlich installiert.

## 4. Legacy-Fallback nur bei nachgewiesenem Ausfall

Auf dem getesteten webOS-3.x-Gerät wurde die Activity trotz erfolgreicher Registrierung nicht ausgelöst. Das Öffnen des Homebrew Channels startete SSH sofort und bewies damit, dass Netzwerk, Dropbear und `startup.sh` in Ordnung waren. Für genau diesen Zustand wurde der EIM-basierte Fallback verwendet.

Der Installer lädt die gepinnte Autoclose-Variante `org.webosbrew.autostart 0.1.4`, prüft die veröffentlichte SHA-256-Prüfsumme, installiert die App, sichert `/var/lib/eim`, registriert die App als Input und richtet das vorgesehene bind-gemountete EIM-Overlay ein. Vor Änderungen verlangt er die explizite Variable `I_UNDERSTAND=YES`.

```sh
I_UNDERSTAND=YES \
TV_HOST=TV_IP \
TV_SSH_KEY_PATH="$HOME/.ssh/lg-tv-root" \
TV_KNOWN_HOSTS_PATH="$HOME/.ssh/known_hosts" \
./tools/install-legacy-autostart-fallback.sh
```

Das zugrunde liegende Problem und der inzwischen im Hauptzweig entwickelte Fix sind in [webos-homebrew-channel #124](https://github.com/webosbrew/webos-homebrew-channel/issues/124) und [PR #230](https://github.com/webosbrew/webos-homebrew-channel/pull/230) dokumentiert. Der separate Fallback ist deshalb als Übergangslösung gepinnt und darf nicht automatisch auf alle Fernseher ausgerollt werden.

## 5. Neustart wirklich verifizieren

Ein offener Port vor dem Neustart reicht nicht. Nach der Installation:

1. Homebrew Channel schließen.
2. Einen echten Systemneustart ausführen.
3. Warten, bis Ping und webOS-Port 3000 zurückkehren.
4. Prüfen, dass Port 22 ohne Öffnen des Homebrew Channels erscheint.
5. Markerzeit, Dropbear-Prozess, Failsafe und EIM-Mount kontrollieren.
6. Noch einen zweiten direkt aufeinanderfolgenden Neustart testen. Ältere EIM-Fallbacks verloren ihre Registrierung teilweise erst beim zweiten Boot.

Auf dem getesteten Wohnzimmer-TV waren beide aufeinanderfolgenden Neustarts erfolgreich. Der Marker wurde automatisch angelegt, Dropbear lauschte auf Port 22, `/var/lib/eim` war aus `/var/lib/webosbrew/eim` bind-gemountet und der Failsafe war nach dem Startup wieder entfernt.

## 6. Rollback des Legacy-Fallbacks

Der Installer nennt den konkreten Sicherungspfad, zum Beispiel:

```text
/var/lib/webosbrew/eim.backup-YYYYMMDD-HHMMSS
```

Ein Rollback sollte nur über eine bestehende Root-Sitzung erfolgen:

1. Autostart-App über den webOS-App-Installer deinstallieren.
2. Aktiven `/var/lib/eim`-Bind-Mount aushängen.
3. `/var/lib/eim` aus der genannten Sicherung wiederherstellen.
4. `/var/lib/webosbrew/eim` erst nach erfolgreicher Wiederherstellung entfernen.
5. Neu starten und prüfen, dass die normalen Eingänge erhalten sind.

Die Sicherung nicht vorschnell löschen. Auf einem nicht mehr automatisch startenden Gerät zuerst den Homebrew Channel manuell öffnen, um SSH zurückzugewinnen.

## 7. NAS-Dashboard deployen

Kopiere das Repository auf den NAS, lege einen dedizierten TV-Schlüssel und `known_hosts` unter `secrets/` ab und erstelle `.env` aus `.env.example`. Danach:

```sh
docker compose up -d --build
```

Das Dashboard unterstützt mehrere Geräte über `TV_HOST`, `BEDROOM_TV_HOST`, `TV_MAC` und `BEDROOM_TV_MAC`. Zugangsdaten bleiben im Backend; der Browser erhält weder SSH-Schlüssel noch freie Shell- oder Luna-Befehle.

## Fehlerbilder

| Symptom | Wahrscheinliche Ursache | Nächster Test |
| --- | --- | --- |
| Ping und 3000 offen, 22 abgelehnt | Homebrew-Startup lief nicht | Homebrew einmal öffnen; erscheint 22 danach, Autostartpfad untersuchen |
| Nach Boot zunächst kein SSH, nach 60–90 Sekunden schon | verzögerte Activity/Preview-Ausführung | keine Reparatur; Dashboard-Startphase berücksichtigen |
| `webosbrew_failsafe` bleibt vorhanden | Startup wurde unterbrochen | keine weiteren Hooks installieren; Logs und Init-Skripte prüfen |
| TV nach Boot vollständig offline | Netzwerk/Link/Wake-on-LAN, nicht Homebrew | Link, DHCP/ARP, Kabel und TV-Netzwerkeinstellung prüfen |
| Dashboard meldet unerreichbar, SSH funktioniert | Browserstatus veraltet oder Dashboard-Auth | Gerät neu auswählen/Seite laden und Backendstatus prüfen |

## Projektgrenzen

Dieses Projekt ersetzt nicht webOS durch ein eigenes Betriebssystem. Es behält webOS als Hardware- und DRM-Schicht, ergänzt Root/Homebrew und stellt eine eng begrenzte lokale Steuerungs- und Sicherungsebene bereit. Bootloader-, Partitions- oder Firmware-Flash-Änderungen sind absichtlich nicht enthalten.
