# LG 55SK7900PLA – DejaVuln root checklist

Prepared for firmware `06.10.65` using official DejaVuln `0.0.10`.

## Before inserting the USB drive

1. Disable automatic software updates on the TV.
2. Disable **Quick Start+**.
3. Uninstall LG's **Developer Mode** app if it is installed.
4. Shut the TV down normally, disconnect any other USB drives, and start it again.

## Exploit-Dateien beziehen

Exploit-Payloads werden bewusst nicht in diesem Repository gespiegelt. Lade die gewünschte Version ausschließlich aus den [offiziellen DejaVuln-Releases](https://github.com/throwaway96/dejavuln-autoroot/releases) und prüfe vor der Verwendung Release, Dateiname und Prüfsumme. Für das getestete Wohnzimmergerät wurde `dejavuln-autoroot 0.0.10` verwendet.

Entpacke das Release in einen lokalen Arbeitsordner. Bewahre `autoroot.log` nach dem Lauf für die Diagnose auf, aber committe weder Payload noch Logdatei in dieses Repository.

## USB drive

Copy the *contents* of the extracted official release directly to the root of a single-partition FAT32 or NTFS USB drive. Do not copy the enclosing release directory itself.

## Run on the TV

1. Insert the USB drive.
2. Open the LG **Music** app (or Media Player).
3. Open the USB drive.
4. Enter the displayed folder named `lol$(sh$IFS$(find$IFS/tmp`.
5. Try to play the displayed MP3 file.
6. A “file cannot be played” message is expected. Wait for the DejaVuln status notifications.
7. When the TV reports **Rooting complete**, safely eject the USB drive and reboot the TV.

If the run fails, do not improvise. Bring the USB drive back to the Mac and inspect `autoroot.log` first.

After successful rooting, continue with [docs/ROOTING-AND-AUTOSTART.md](docs/ROOTING-AND-AUTOSTART.md) to provision a dedicated SSH key, disable Telnet, verify Homebrew startup and configure the NAS dashboard.
