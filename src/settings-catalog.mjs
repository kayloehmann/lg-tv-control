const onOff = [
  { value: "on", label: "Ein" },
  { value: "off", label: "Aus" }
];

const bool = [
  { value: true, label: "Ein" },
  { value: false, label: "Aus" }
];

const trueFalse = [
  { value: "true", label: "Ein" },
  { value: "false", label: "Aus" }
];

export const explorerCategories = ["general", "network", "time", "picture", "sound", "option"];

export const settingsCatalog = [
  {
    id: "general.homePromotion", category: "general", key: "homePromotion",
    group: "Datenschutz", label: "Home-Promotion", description: "Werbliche Inhalte auf der LG-Startseite.",
    options: onOff, recommended: "off"
  },
  {
    id: "general.adCookie", category: "general", key: "adCookie",
    group: "Datenschutz", label: "Werbe-Cookie", description: "Lokale Werbeprofil-Funktion von LG.",
    options: onOff, recommended: "off"
  },
  {
    id: "general.personalRecommend", category: "general", key: "personalRecommend",
    group: "Datenschutz", label: "Persönliche Empfehlungen", description: "Personalisierte Empfehlungen auf Basis der Nutzung.",
    options: onOff, recommended: "off",
    decode: value => value?.value ?? value,
    encode: value => ({ changedByUser: true, value })
  },
  {
    id: "general.customizedAd", category: "general", key: "customizedAd",
    group: "Datenschutz", label: "Personalisierte Werbung", description: "Individualisierte Werbeinhalte.",
    options: onOff, recommended: "off"
  },
  {
    id: "option.livePlus", category: "option", key: "livePlus",
    group: "Datenschutz", label: "Live Plus / ACR", description: "Erkennung und Analyse laufender TV-Inhalte.",
    options: onOff, recommended: "off", risk: "medium"
  },
  {
    id: "option.watchedListCollection", category: "option", key: "watchedListCollection",
    group: "Datenschutz", label: "Sehverlauf sammeln", description: "Sammlung der angesehenen Inhalte.",
    options: onOff, recommended: "off"
  },
  {
    id: "option.speakToTv", category: "option", key: "speakToTv",
    group: "Datenschutz", label: "Mit TV sprechen", description: "Sprachinteraktion mit dem Fernseher.",
    options: onOff, recommended: "off"
  },
  {
    id: "option.turnOnByVoice", category: "option", key: "turnOnByVoice",
    group: "Datenschutz", label: "Per Sprache einschalten", description: "Spracherkennung im Bereitschaftsbetrieb.",
    options: onOff, recommended: "off"
  },
  {
    id: "network.wolwowlOnOff", category: "network", key: "wolwowlOnOff",
    group: "Netzwerk", label: "Wake-on-LAN/WLAN", description: "Erlaubt das Einschalten über das Netzwerk.",
    options: trueFalse, recommended: "true"
  },
  {
    id: "network.allowMobileDeviceAccess", category: "network", key: "allowMobileDeviceAccess",
    group: "Netzwerk", label: "LG Connect Apps / SSAP", description: "Erlaubt Netzwerksteuerung über Port 3000/3001.",
    options: bool, recommended: true, risk: "medium",
    warning: "Ausschalten trennt Home Assistant, Fernbedienungs-Apps und den Netzwerk-Launcher."
  },
  {
    id: "network.bleAdvertisingOnOff", category: "network", key: "bleAdvertisingOnOff",
    group: "Netzwerk", label: "Bluetooth-Werbung", description: "BLE-Advertising des Fernsehers im Standby.",
    options: onOff, recommended: "off"
  },
  {
    id: "time.autoOff15Min", category: "time", key: "autoOff15Min",
    group: "Energie", label: "15-Minuten-Auto-Off", description: "Schaltet bei Inaktivität auf dem No-Signal-Bildschirm ab.",
    options: onOff, recommended: "on"
  },
  {
    id: "time.noSignalAutoOff", category: "time", key: "noSignalAutoOff",
    group: "Energie", label: "Ohne Signal abschalten", description: "Automatische Abschaltung, wenn kein Signal anliegt.",
    options: onOff, recommended: "on"
  },
  {
    id: "time.noOperationAutoOff", category: "time", key: "noOperationAutoOff",
    group: "Energie", label: "Ohne Bedienung abschalten", description: "Automatische Abschaltung ohne Benutzereingabe.",
    options: onOff
  },
  {
    id: "option.quickStartMode", category: "option", key: "quickStartMode",
    group: "Energie", label: "Quick Start+", description: "Schnellstart mit höherem Standby-Verbrauch; für stabilen Root-Boot besser aus.",
    options: onOff, recommended: "off", restartRequired: true
  },
  {
    id: "general.noSignalScreenSaver", category: "general", key: "noSignalScreenSaver",
    group: "Oberfläche", label: "No-Signal-Screensaver", description: "LG-Bilder anzeigen, wenn kein Eingangssignal anliegt.",
    options: onOff
  },
  {
    id: "general.screenSaverEnabled", category: "general", key: "screenSaverEnabled",
    group: "Oberfläche", label: "Bildschirmschoner", description: "Systemweiten Bildschirmschoner aktivieren.",
    options: onOff, recommended: "on"
  },
  {
    id: "general.homeAutoLaunch", category: "general", key: "homeAutoLaunch",
    group: "Oberfläche", label: "Home automatisch öffnen", description: "LG Home beim Einschalten automatisch anzeigen.",
    options: onOff
  },
  {
    id: "option.animationGuide", category: "option", key: "animationGuide",
    group: "Oberfläche", label: "Menüanimationen", description: "Animationen und Übergangshilfen in der Oberfläche.",
    options: onOff
  },
  {
    id: "option.enableToastPopup", category: "option", key: "enableToastPopup",
    group: "Oberfläche", label: "Hinweis-Popups", description: "Systemweite Toast-Benachrichtigungen anzeigen.",
    options: onOff, recommended: "on"
  },
  {
    id: "option.pointerSpeed", category: "option", key: "pointerSpeed",
    group: "Oberfläche", label: "Magic-Remote-Geschwindigkeit", description: "Geschwindigkeit des Bildschirmzeigers.",
    options: [
      { value: "slow", label: "Langsam" }, { value: "normal", label: "Normal" }, { value: "fast", label: "Schnell" }
    ]
  },
  {
    id: "option.pointerSize", category: "option", key: "pointerSize",
    group: "Oberfläche", label: "Magic-Remote-Zeigergröße", description: "Größe des Bildschirmzeigers.",
    options: [
      { value: "small", label: "Klein" }, { value: "medium", label: "Mittel" }, { value: "large", label: "Groß" }
    ]
  },
  {
    id: "sound.startupSound", category: "sound", key: "startupSound",
    group: "Ton", label: "Startton", description: "Ton beim Starten der TV-Oberfläche.",
    options: onOff
  },
  {
    id: "sound.tvPowerSound", category: "sound", key: "tvPowerSound",
    group: "Ton", label: "Ein-/Ausschaltton", description: "Akustisches Feedback beim Ein- und Ausschalten.",
    options: onOff
  },
  {
    id: "sound.autoVolume", category: "sound", key: "autoVolume",
    group: "Ton", label: "Automatische Lautstärke", description: "Gleicht Lautstärkeunterschiede zwischen Inhalten aus.",
    options: onOff
  },
  {
    id: "sound.clearVoice", category: "sound", key: "clearVoice",
    group: "Ton", label: "Clear Voice", description: "Hebt Sprache gegenüber Hintergrundton hervor.",
    options: onOff
  },
  {
    id: "sound.virtualSurround", category: "sound", key: "virtualSurround",
    group: "Ton", label: "Virtual Surround", description: "Virtuelle Surround-Verarbeitung der TV-Lautsprecher.",
    options: onOff
  },
  {
    id: "picture.pictureMode", category: "picture", key: "pictureMode",
    group: "Bild & Ton", label: "Bildmodus", description: "Bildprofil für den aktuell aktiven Eingang und Dynamikbereich.",
    options: [
      { value: "normal", label: "Standard" }, { value: "eco", label: "Eco" },
      { value: "cinema", label: "Kino" }, { value: "sports", label: "Sport" },
      { value: "game", label: "Spiel" }, { value: "expert1", label: "Experte hell" },
      { value: "expert2", label: "Experte dunkel" }
    ]
  },
  {
    id: "sound.soundMode", category: "sound", key: "soundMode",
    group: "Bild & Ton", label: "Tonmodus", description: "Tonprofil für den aktuell aktiven Eingang.",
    options: [
      { value: "standard", label: "Standard" }, { value: "movie", label: "Kino" },
      { value: "news", label: "Sprache" }, { value: "sports", label: "Sport" },
      { value: "music", label: "Musik" }, { value: "game", label: "Spiel" }
    ]
  },
  {
    id: "option.hbbTV", category: "option", key: "hbbTV",
    group: "TV & Dienste", label: "HbbTV", description: "Interaktive Senderdienste und Mediatheken über den roten Knopf.",
    options: onOff
  }
];

export const settingById = new Map(settingsCatalog.map(setting => [setting.id, setting]));

export function validateValue(setting, value) {
  return setting.options.some(option => Object.is(option.value, value));
}

export function displayValue(setting, rawValue) {
  return setting.decode ? setting.decode(rawValue) : rawValue;
}

export function encodedValue(setting, value) {
  return setting.encode ? setting.encode(value) : value;
}
