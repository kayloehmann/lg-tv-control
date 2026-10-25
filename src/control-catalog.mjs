const safeApps = [
  ["com.webos.app.livetv", "Live TV", "TV", true],
  ["youtube.leanback.v4", "YouTube", "YT"],
  ["netflix", "Netflix", "N"],
  ["amazon", "Prime Video", "P"],
  ["com.disney.disneyplus-prod", "Disney+", "D+"],
  ["com.apple.appletv", "Apple TV", ""],
  ["cdp-30", "Plex", "PX"],
  ["org.jellyfin.webos", "Jellyfin", "JF"],
  ["joyn", "Joyn", "J"],
  ["ard.mediathek", "ARD Mediathek", "ARD"],
  ["de.zdf.app.zdfm3", "ZDF", "ZDF"],
  ["dazn", "DAZN", "DZ"],
  ["de.sky.skyonline", "WOW", "W"],
  ["de.telekom.magentasport", "MagentaSport", "MS"],
  ["de.sdtv.tvapp", "Sportdeutschland.TV", "SD"],
  ["org.webosbrew.hbchannel", "Homebrew Channel", "HB"]
].map(([id, label, badge, alwaysAvailable = false]) => ({ id, label, badge, alwaysAvailable }));

export const safeAppById = new Map(safeApps.map(app => [app.id, app]));

const remoteButtons = [
  ["home", "HOME", "Home", "⌂", "navigation"],
  ["back", "BACK", "Zurück", "↶", "navigation"],
  ["settings", "QMENU", "Einstellungen", "⚙", "navigation"],
  ["info", "INFO", "Info", "i", "navigation"],
  ["up", "UP", "Nach oben", "↑", "dpad"],
  ["left", "LEFT", "Nach links", "←", "dpad"],
  ["enter", "ENTER", "OK", "OK", "dpad"],
  ["right", "RIGHT", "Nach rechts", "→", "dpad"],
  ["down", "DOWN", "Nach unten", "↓", "dpad"],
  ["rewind", "REWIND", "Zurückspulen", "⏪", "media"],
  ["play", "PLAY", "Wiedergabe", "▶", "media"],
  ["pause", "PAUSE", "Pause", "⏸", "media"],
  ["stop", "STOP", "Stopp", "⏹", "media"],
  ["fast-forward", "FASTFORWARD", "Vorspulen", "⏩", "media"],
  ["volume-down", "VOLUMEDOWN", "Leiser", "−", "volume"],
  ["volume-up", "VOLUMEUP", "Lauter", "+", "volume"],
  ["channel-down", "CHANNELDOWN", "Programm zurück", "P−", "channel"],
  ["channel-up", "CHANNELUP", "Programm weiter", "P+", "channel"]
].map(([id, command, label, icon, group]) => ({ id, command, label, icon, group }));

export const safeRemoteButtonById = new Map(remoteButtons.map(button => [button.id, button]));

export function allowedRemoteButtons() {
  return remoteButtons.map(({ command, ...button }) => button);
}

export function allowedApps(launchPoints = []) {
  const installed = new Map(launchPoints.map(app => [app.id, app]));
  return safeApps.flatMap(app => {
    const live = installed.get(app.id);
    return live || app.alwaysAvailable ? [{ ...app, label: live?.title || app.label, alwaysAvailable: undefined }] : [];
  });
}

export function allowedInputs(devices = []) {
  return devices
    .filter(input => /^HDMI_[1-4]$/.test(input.id) && /^com\.webos\.app\.hdmi[1-4]$/.test(input.appId))
    .map(input => ({
      id: input.id,
      appId: input.appId,
      label: input.label || `HDMI ${input.port}`,
      port: input.port,
      active: Boolean(input.activate),
      connected: input.connected !== false || Boolean(input.activate)
    }));
}
