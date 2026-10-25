import { settingById, validateValue } from "./settings-catalog.mjs";

export const profilesCatalog = [
  {
    id: "privacy",
    label: "Privatsphäre",
    description: "Reduziert Werbung, Personalisierung und die Erfassung des Sehverhaltens.",
    note: "Netzwerksteuerung, Home Assistant, Wake-on-LAN und Sprachfunktionen bleiben unverändert.",
    targets: [
      { id: "general.homePromotion", value: "off" },
      { id: "general.adCookie", value: "off" },
      { id: "general.personalRecommend", value: "off" },
      { id: "general.customizedAd", value: "off" },
      { id: "option.livePlus", value: "off" },
      { id: "option.watchedListCollection", value: "off" }
    ]
  },
  {
    id: "energy-safe",
    label: "Energiesparen",
    description: "Reduziert unnötigen Standby-Verbrauch und schaltet bei fehlendem Signal automatisch ab.",
    note: "Wake-on-LAN, LG Connect, Home Assistant und die Abschaltung während normaler Nutzung bleiben unverändert. Quick Start+ benötigt nach einer Änderung einen TV-Neustart.",
    targets: [
      { id: "time.autoOff15Min", value: "on" },
      { id: "time.noSignalAutoOff", value: "on" },
      { id: "option.quickStartMode", value: "off" }
    ]
  },
  {
    id: "movie-night",
    label: "Filmabend",
    description: "Stimmt Bild und Ton des aktuellen Eingangs auf Filme ab.",
    note: "Wirkt nur auf den aktuell aktiven Eingang und lässt Apps, Lautstärke und Netzwerk unverändert.",
    targets: [
      { id: "picture.pictureMode", value: "cinema" },
      { id: "sound.soundMode", value: "movie" }
    ]
  },
  {
    id: "sports",
    label: "Sport",
    description: "Aktiviert die Sportprofile für Bild und Ton des aktuellen Eingangs.",
    note: "Wirkt nur auf den aktuell aktiven Eingang. Das Profil kann über den Änderungsverlauf rückgängig gemacht werden.",
    targets: [
      { id: "picture.pictureMode", value: "sports" },
      { id: "sound.soundMode", value: "sports" }
    ]
  },
  {
    id: "night",
    label: "Nachtmodus",
    description: "Ruhiges Kinobild mit sprachbetontem Ton.",
    note: "Die Lautstärke wird nicht automatisch verändert. Clear Voice bleibt separat steuerbar.",
    targets: [
      { id: "picture.pictureMode", value: "cinema" },
      { id: "sound.soundMode", value: "news" }
    ]
  },
  {
    id: "gaming",
    label: "Gaming",
    description: "Schaltet Bild und Ton des aktuellen Eingangs in den Spielmodus.",
    note: "Das Dashboard ändert keine HDMI-Bezeichnung und keinen Eingang automatisch.",
    targets: [
      { id: "picture.pictureMode", value: "game" },
      { id: "sound.soundMode", value: "game" }
    ]
  }
];

for (const profile of profilesCatalog) {
  for (const target of profile.targets) {
    const setting = settingById.get(target.id);
    if (!setting || !validateValue(setting, target.value)) {
      throw new Error(`Ungültiges Profilziel: ${profile.id}/${target.id}`);
    }
  }
}

export const profileById = new Map(profilesCatalog.map(profile => [profile.id, profile]));
