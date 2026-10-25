# LG TV Control

Lokales NAS-Dashboard für einen gerooteten LG 55SK7900PLA. Das Backend verbindet sich per SSH mit dem TV und nutzt dessen Luna Settings Service. Der Root-Schlüssel wird niemals an den Browser übertragen.

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
export TV_HOST=10.222.0.83
export TV_SSH_KEY_PATH="$HOME/.ssh/id_ed25519"
export TV_KNOWN_HOSTS_PATH="$HOME/.ssh/known_hosts"
export DASHBOARD_USERNAME=kay
export DASHBOARD_PASSWORD='mindestens-12-zeichen'
npm test
npm start
```

Danach `http://localhost:3000` öffnen.

## Synology-Deployment

1. Einen eigenen Ordner anlegen, zum Beispiel `/volume1/docker/lg-tv-control/`.
2. Projektdateien dorthin kopieren.
3. Unter `secrets/` einen dedizierten SSH-Schlüssel und eine `known_hosts`-Datei ablegen.
4. `.env.example` als `.env` kopieren und insbesondere ein langes Dashboard-Passwort setzen.
5. Sicherstellen, dass der NAS den TV auf `10.222.0.83:22` erreichen darf.
6. Starten:

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

## Home Assistant

`home-assistant/lg_tv_control.yaml` ist ein isoliertes Home-Assistant-Paket für die bereits vorhandenen webOS-TV-Entitäten und die eingeschränkte Automations-API des Dashboards. Es stellt Status-, Root-, Firmware-Schutz-, Quellen- und Lautstärkesensoren sowie Buttons für Medienprofile und alle aktuellen Favoriten bereit. Die vorhandenen Apple-TV- und Ausschalt-Skripte bleiben erhalten. Der Token liegt nur in Home Assistants `secrets.yaml` und als read-only Secret-Datei im NAS-Container.

`home-assistant/lg_tv_view.yaml` enthält die native Sections-Ansicht „Fernseher“ für das bestehende YAML-Systemdashboard. Sie nutzt ausschließlich Core-Karten und verlangt vor „Alle Fernseher ausschalten“ eine Bestätigung.

Die optionale Wohnzimmer-Automatik `automation.lg_tv_wohnzimmer_switch_gaming_profil` reagiert direkt auf das Quellenattribut der vorhandenen webOS-Entität. Sie wartet nach dem Wechsel auf „Nintendo Switch“ fünf Sekunden, prüft Quelle und Betriebszustand erneut und aktiviert dann das Gaming-Profil. Der Helfer `input_boolean.lg_tv_wohnzimmer_switch_gaming_auto` schaltet die Funktion dauerhaft ein oder aus.

Zwei weitere Automationen überwachen Root und Firmware-Schutz beider TVs. Nach fünf Minuten in `off`, `unknown` oder `unavailable` erscheint eine interne Home-Assistant-Warnung; nach einer Minute im gesunden Zustand wird sie automatisch entfernt. Es werden keine externen Push-Nachrichten versendet.
