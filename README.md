# LG TV Control

Lokales NAS-Dashboard für gerootete LG-webOS-Fernseher. Das Backend verbindet sich per SSH mit dem TV und nutzt dessen Luna Settings Service. Der Root-Schlüssel wird niemals an den Browser übertragen.

Das Projekt ist unter der [MIT-Lizenz](LICENSE) veröffentlicht. Pull Requests und nachvollziehbare Ergebnisse weiterer Modell-/Firmwarekombinationen sind willkommen. Rooting und Systemänderungen erfolgen auf eigene Verantwortung; prüfe die Kompatibilität für dein konkretes Gerät, bevor du Befehle ausführst.

Getestet wurde der Betrieb mit:

| Gerät | Firmware | webOS | Besonderheit |
| --- | --- | --- | --- |
| LG 55SK7900PLA | `06.10.65` | 3.x | Homebrew-Autostart benötigt auf dem Testgerät den dokumentierten EIM-Fallback |
| LG 43UM74507LA | `05.40.97` | 4.5 / SDK `4.10.0` | Homebrew-Activity startet automatisch, SSH kann erst nach etwa 60–90 Sekunden verfügbar sein |

Die vollständige, reproduzierbare Vorgehensweise für Root-Zugang, SSH-Härtung, Autostart-Diagnose, Legacy-Fallback, Verifikation und Rollback steht in [docs/ROOTING-AND-AUTOSTART.md](docs/ROOTING-AND-AUTOSTART.md). Die Anleitung ersetzt keine modell- und firmwarebezogene Kompatibilitätsprüfung.

## Sicherheitsmodell

- HTTP Basic Auth ist verpflichtend.
- Änderungen sind nur für eine feste Allowlist möglich.
- Auch Fernbedienungstasten werden serverseitig gegen eine feste Allowlist geprüft; freie Tastennamen oder Systembefehle akzeptiert die API nicht.
- Werte werden vor und nach einer Änderung vom TV gelesen.
- Der SSH-Host-Key muss bereits in `known_hosts` stehen.
- Der private Schlüssel wird nur read-only in den Container eingebunden.
- Der Container läuft mit schreibgeschütztem Dateisystem, ohne Linux-Capabilities und mit `no-new-privileges`.
- Der Parameter-Explorer ist nur lesend und blendet PIN-/Passwort-/Schlüsselfelder aus.
- Home Assistant nutzt einen eigenen Bearer-Token aus einer read-only eingebundenen Secret-Datei. Die Automations-API akzeptiert ausschließlich vier Medienprofile und die je TV gespeicherten Favoriten.

Das Dashboard sollte nur über das interne LAN oder einen bestehenden VPN-Zugang erreichbar sein. Es darf nicht direkt ins Internet veröffentlicht werden.

## Lokaler Test

```sh
export TV_HOST=192.168.1.50
export TV_SSH_KEY_PATH="$HOME/.ssh/id_ed25519"
export TV_KNOWN_HOSTS_PATH="$HOME/.ssh/known_hosts"
export DASHBOARD_USERNAME=admin
export DASHBOARD_PASSWORD='mindestens-12-zeichen'
npm test
npm start
```

Danach `http://localhost:3000` öffnen.

## Homebrew-Autostart prüfen

Das Diagnosewerkzeug verändert den Fernseher nicht:

```sh
TV_HOST=192.0.2.10 \
TV_SSH_KEY_PATH="$HOME/.ssh/lg-tv-root" \
TV_KNOWN_HOSTS_PATH="$HOME/.ssh/known_hosts" \
./tools/diagnose-homebrew-autostart.sh
```

Den Legacy-Fallback nicht vorsorglich installieren. Er ist nur für Geräte gedacht, bei denen webOS bereits erreichbar ist, Homebrew/SSH nach einem echten Neustart aber dauerhaft nicht automatisch startet. Details und Sicherheitsabfragen stehen in der ausführlichen Anleitung.

## Synology-Deployment

1. Einen eigenen Ordner anlegen, zum Beispiel `/volume1/docker/lg-tv-control/`.
2. Projektdateien dorthin kopieren.
3. Unter `secrets/` einen dedizierten SSH-Schlüssel und eine `known_hosts`-Datei ablegen.
4. Für die Home-Assistant-Bridge einen separaten Token erzeugen: `mkdir -p secrets && openssl rand -hex 32 > secrets/lg_tv_ha_token`.
5. `.env.example` als `.env` kopieren, die Beispiel-IP-/MAC-Adressen ersetzen und insbesondere ein langes Dashboard-Passwort setzen.
6. Sicherstellen, dass der NAS den TV auf `TV_HOST:22` erreichen darf.
7. Starten:

```sh
docker compose up -d --build
```

Das Dashboard ist anschließend standardmäßig auf Port `3083` verfügbar.

## Schreibbare Parameter der ersten Version

- Datenschutz und Werbefunktionen
- Netzwerkzugriff, Wake-on-LAN und BLE
- Energie- und Abschaltverhalten
- Screensaver und UI-Verhalten
- Magic-Remote-Zeiger
- ausgewählte Tonoptionen
- HbbTV

Bildkalibrierung, Länder-/Servicemenüwerte und Kindersicherung sind absichtlich nicht schreibbar.

## Aktionszentrum

Das Dashboard erkennt installierte Apps und HDMI-Eingänge je Fernseher. Zusätzlich stehen Lautstärke, Stummschaltung, Bildschirm- und Energieaktionen sowie eine webOS-Fernbedienung bereit. Die Fernbedienung umfasst Navigation, Home, Zurück, Quick-Menü, Info, Mediensteuerung, Lautstärke und Programmwahl. Nicht freigegebene Tastennamen werden bereits im Backend abgewiesen.

Weitere Funktionen:

- bis zu acht dauerhaft auf dem NAS gespeicherte Favoriten je Fernseher
- rückgängig machbare Szenen für Film, Sport, Nacht und Gaming
- Bild- und Tonmodus des aktuell aktiven Eingangs
- Touchpad, Scrollen und Texteingabe über den nativen webOS-Eingabedienst
- Wartungsübersicht für Root, Firmware-Blockade, Homebrew, Laufzeit und Apps
- exportierbare und validiert wiederherstellbare Backups ausschließlich freigegebener Werte
- vollständige, serverseitige Gerätesicherungen für jeden TV mit Prüfsumme und TAR-Inhaltsprüfung

Die vollständigen Gerätesicherungen liegen ausschließlich unter `/data/backups/<tv>/` auf der NAS. Sie enthalten webOS-Präferenzen, Homebrew-Konfiguration, Homebrew-Apps und gerätegebundene Schlüssel. Deshalb werden sie nicht an den Browser ausgeliefert und mit Dateimodus `0600` gespeichert. Ein automatischer Voll-Restore ist bewusst nicht vorhanden: Modell und Firmware müssen vor einer manuellen Wiederherstellung geprüft werden.

Der produktive NAS-Host startet `node /app/src/backup-cli.mjs` täglich vor dem bestehenden Hyper-Backup-Lauf. Der CLI-Lauf sichert beide Fernseher unabhängig, validiert SHA-256 und TAR-Inhalt und bewahrt je Gerät die 30 neuesten vollständigen Manifest-/Archivpaare auf. Unvollständige oder beschädigte Paare werden zur Diagnose nicht automatisch entfernt. Der letzte Lauf steht in `/data/backups/last-daily-run.json`.

Auf der NAS ruft `/volume1/docker/lg-tv-control/tools/run-daily-backup.sh` den CLI-Lauf um 22:50 Uhr auf. Erfolg oder Fehler gehen unter dem Tag `lg-tv-backup` ins Systemprotokoll. Die Sicherung weckt ausgeschaltete Fernseher nicht auf; ein nicht erreichbares Gerät führt zu einem sichtbaren Fehlerstatus, ohne die letzte gültige Sicherung zu verändern.

## Home Assistant

`home-assistant/lg_tv_control.yaml` ist ein isoliertes Home-Assistant-Paket für die bereits vorhandenen webOS-TV-Entitäten und die eingeschränkte Automations-API des Dashboards. Es stellt Status-, Root-, Firmware-Schutz-, Quellen- und Lautstärkesensoren sowie Buttons für Medienprofile und alle aktuellen Favoriten bereit. Die vorhandenen Apple-TV- und Ausschalt-Skripte bleiben erhalten. Der Token liegt nur in Home Assistants `secrets.yaml` und als read-only Secret-Datei im NAS-Container.

`home-assistant/lg_tv_view.yaml` enthält die native Sections-Ansicht „Fernseher“ für das bestehende YAML-Systemdashboard. Sie nutzt ausschließlich Core-Karten und verlangt vor „Alle Fernseher ausschalten“ eine Bestätigung.

Die optionale Wohnzimmer-Automatik `automation.lg_tv_wohnzimmer_switch_gaming_profil` reagiert direkt auf das Quellenattribut der vorhandenen webOS-Entität. Sie wartet nach dem Wechsel auf „Nintendo Switch“ fünf Sekunden, prüft Quelle und Betriebszustand erneut und aktiviert dann das Gaming-Profil. Der Helfer `input_boolean.lg_tv_wohnzimmer_switch_gaming_auto` schaltet die Funktion dauerhaft ein oder aus.

Zwei weitere Automationen überwachen Root und Firmware-Schutz beider TVs. Nach fünf Minuten in `off`, `unknown` oder `unavailable` erscheint eine interne Home-Assistant-Warnung; nach einer Minute im gesunden Zustand wird sie automatisch entfernt. Es werden keine externen Push-Nachrichten versendet.
