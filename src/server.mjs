import { createHash, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  displayValue, encodedValue, explorerCategories, settingById, settingsCatalog, validateValue
} from "./settings-catalog.mjs";
import { profileById, profilesCatalog } from "./profiles.mjs";
import { HistoryStore } from "./history-store.mjs";
import { PreferencesStore } from "./preferences-store.mjs";
import { SystemBackupStore } from "./system-backup-store.mjs";
import { allowedApps, allowedInputs, allowedRemoteButtons, safeAppById, safeRemoteButtonById } from "./control-catalog.mjs";
import { TvClient } from "./tv-client.mjs";
import { sendWakeOnLan } from "./wol.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const publicDir = join(root, "public");
const port = Number(process.env.PORT || 3000);
const username = process.env.DASHBOARD_USERNAME || "";
const password = process.env.DASHBOARD_PASSWORD || "";
const automationTokenPath = process.env.AUTOMATION_TOKEN_PATH || "/run/secrets/lg_tv_ha_token";
let automationToken = "";
try { automationToken = (await readFile(automationTokenPath, "utf8")).trim(); } catch { /* Home Assistant bridge stays disabled without its dedicated secret */ }
const history = new HistoryStore(process.env.HISTORY_PATH || "/data/history.json");
const preferences = new PreferencesStore(process.env.PREFERENCES_PATH || "/data/preferences.json");
const systemBackups = new SystemBackupStore(process.env.SYSTEM_BACKUP_DIR || "/data/backups");

if (!username || password.length < 12) {
  console.error("DASHBOARD_USERNAME und ein DASHBOARD_PASSWORD mit mindestens 12 Zeichen sind erforderlich.");
  process.exit(1);
}

const commonTvConfig = {
  port: Number(process.env.TV_SSH_PORT || 22),
  user: process.env.TV_SSH_USER || "root",
  keyPath: process.env.TV_SSH_KEY_PATH || "/run/secrets/tv_ssh_key",
  knownHostsPath: process.env.TV_KNOWN_HOSTS_PATH || "/run/secrets/known_hosts"
};
const deviceDefinitions = [
  { id: "living-room", label: "Wohnzimmer", host: process.env.TV_HOST || "10.222.0.83", mac: process.env.TV_MAC || "78:5d:c8:99:06:8b" },
  { id: "bedroom", label: "Schlafzimmer", host: process.env.BEDROOM_TV_HOST || "10.222.0.96", mac: process.env.BEDROOM_TV_MAC || "20:17:42:55:98:53" }
];
const tvClients = new Map(deviceDefinitions.map(device => [device.id, new TvClient({ ...commonTvConfig, host: device.host })]));

const expectedAuth = Buffer.from(`Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`);
const mimeTypes = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml"
};

function authenticated(request) {
  const actual = Buffer.from(request.headers.authorization || "");
  return actual.length === expectedAuth.length && timingSafeEqual(actual, expectedAuth);
}

function automationAuthenticated(request) {
  if (automationToken.length < 32) return false;
  const actual = Buffer.from(request.headers.authorization || "");
  const expected = Buffer.from(`Bearer ${automationToken}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function json(response, status, body) {
  const data = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(data) });
  response.end(data);
}

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return deviceDefinitions.reduce((safe, device) => safe.replaceAll(device.host, "TV"), message);
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16_384) throw new Error("Anfrage ist zu groß.");
  }
  return JSON.parse(body || "{}");
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  return new URL(origin).host === request.headers.host;
}

async function retryRead(operation) {
  try { return await operation(); } catch { return operation(); }
}

function redactSettings(settings) {
  const result = {};
  for (const [key, value] of Object.entries(settings)) {
    if (/password|passphrase|pin|secret|token|networkkey/i.test(key)) continue;
    if (/^keyList|^inputList/.test(key)) continue;
    if (Array.isArray(value) && value.length > 8) continue;
    result[key] = value;
  }
  return result;
}

function controlView(raw) {
  const apps = allowedApps(raw.launchPoints);
  const inputs = allowedInputs(raw.inputs).map(input => ({ ...input, active: input.appId === raw.foregroundAppId }));
  const activeInput = inputs.find(input => input.active);
  const currentApp = apps.find(app => app.id === raw.foregroundAppId);
  return {
    powerState: raw.powerState,
    foregroundAppId: raw.foregroundAppId,
    foregroundLabel: activeInput?.label || currentApp?.label || raw.launchPoints.find(app => app.id === raw.foregroundAppId)?.title || "Unbekannt",
    apps,
    inputs,
    remote: raw.remoteAvailable ? { available: true, buttons: allowedRemoteButtons() } : { available: false, buttons: [] },
    audio: raw.audio
  };
}

function favoriteChoices(view) {
  return [
    ...view.apps.map(app => ({ id: `app:${app.id}`, type: "app", target: app.id, label: app.label, badge: app.badge })),
    ...view.inputs.map(input => ({ id: `input:${input.id}`, type: "input", target: input.id, label: input.label, badge: `HDMI ${input.port}` }))
  ];
}

async function addFavorites(deviceId, view) {
  const choices = favoriteChoices(view);
  const allowed = new Set(choices.map(choice => choice.id));
  const stored = await preferences.get(deviceId);
  const saved = stored.favorites.filter(id => allowed.has(id));
  const defaults = [...choices.filter(choice => choice.type === "app").slice(0, 4), ...choices.filter(choice => choice.type === "input" && view.inputs.find(input => input.id === choice.target)?.connected).slice(0, 2)].map(choice => choice.id);
  const selected = stored.configured ? saved : defaults;
  return { ...view, favoriteChoices: choices, favorites: selected };
}

async function safeSettingsSnapshot(tv) {
  const categories = [...new Set(settingsCatalog.map(setting => setting.category))];
  const values = Object.fromEntries(await Promise.all(categories.map(async category => [category, await retryRead(() => tv.getCategory(category, { fresh: true }))])));
  const settings = {};
  for (const setting of settingsCatalog) {
    const category = values[setting.category];
    if (Object.hasOwn(category.settings, setting.key)) settings[setting.id] = displayValue(setting, category.settings[setting.key]);
  }
  return { settings, dimensions: Object.fromEntries(categories.map(category => [category, values[category].dimension])) };
}

async function applyProfile(device, tv, profile) {
  const categories = [...new Set(profile.targets.map(target => settingById.get(target.id).category))];
  const snapshots = Object.fromEntries(await Promise.all(categories.map(async category => [category, await tv.getCategory(category, { fresh: true })])));
  const changes = profile.targets.flatMap(target => {
    const setting = settingById.get(target.id);
    const category = snapshots[setting.category];
    if (!Object.hasOwn(category.settings, setting.key)) return [];
    const oldValue = displayValue(setting, category.settings[setting.key]);
    return Object.is(oldValue, target.value) ? [] : [{ setting, oldValue, value: target.value }];
  });

  const applied = [];
  const attempted = [];
  try {
    for (const change of changes) {
      attempted.push(change);
      await tv.setSetting(change.setting.category, change.setting.key, encodedValue(change.setting, change.value));
      const after = await tv.getCategory(change.setting.category, { fresh: true });
      const actualValue = displayValue(change.setting, after.settings[change.setting.key]);
      if (!Object.is(actualValue, change.value)) throw new Error(`${change.setting.label} wurde vom TV nicht bestätigt.`);
      applied.push({ ...change, actualValue });
      console.log(JSON.stringify({ event: "profile-setting-change", at: new Date().toISOString(), device: device.id, profile: profile.id, id: change.setting.id, oldValue: change.oldValue, requested: change.value, actualValue, verified: true }));
    }
  } catch (error) {
    const rollback = [];
    for (const change of [...attempted].reverse()) {
      try {
        await tv.setSetting(change.setting.category, change.setting.key, encodedValue(change.setting, change.oldValue));
        const after = await tv.getCategory(change.setting.category, { fresh: true });
        rollback.push({ id: change.setting.id, restored: Object.is(displayValue(change.setting, after.settings[change.setting.key]), change.oldValue) });
      } catch {
        rollback.push({ id: change.setting.id, restored: false });
      }
    }
    console.error(JSON.stringify({ event: "profile-rollback", at: new Date().toISOString(), device: device.id, profile: profile.id, rollback }));
    const failure = new Error(safeError(error));
    failure.statusCode = 409;
    failure.responseBody = { error: failure.message, rollback };
    throw failure;
  }

  const historyEntry = applied.length ? await history.append({
    device: device.id,
    type: "profile",
    label: profile.label,
    changes: applied.map(change => ({ id: change.setting.id, label: change.setting.label, oldValue: change.oldValue, value: change.actualValue })),
    restartRequired: applied.some(change => change.setting.restartRequired)
  }) : null;

  return {
    id: profile.id,
    changed: applied.map(change => ({ id: change.setting.id, oldValue: change.oldValue, value: change.actualValue })),
    restartRequired: applied.some(change => change.setting.restartRequired),
    historyId: historyEntry?.id || null
  };
}

async function automationApi(request, response, url) {
  try {
    const deviceId = url.searchParams.get("device") || deviceDefinitions[0].id;
    const device = deviceDefinitions.find(candidate => candidate.id === deviceId);
    const tv = tvClients.get(deviceId);
    if (!device || !tv) return json(response, 400, { error: "Unbekannter Fernseher." });

    if (request.method === "GET" && url.pathname === "/api/automation/status") {
      const [status, rawControl] = await Promise.all([retryRead(() => tv.status()), retryRead(() => tv.controlState())]);
      const control = await addFavorites(device.id, controlView(rawControl));
      const choices = new Map(control.favoriteChoices.map(choice => [choice.id, choice]));
      return json(response, 200, {
        device: device.id,
        label: device.label,
        online: true,
        root: status.root,
        updates_blocked: status.updatesBlocked,
        power_state: control.powerState,
        active_source: control.foregroundLabel,
        volume: control.audio?.volume ?? null,
        muted: control.audio?.muted ?? null,
        favorites: control.favorites.map(id => ({ id, label: choices.get(id)?.label || id }))
      });
    }

    if (request.method === "POST" && url.pathname === "/api/automation/action") {
      const body = await readJson(request);
      if (body.action === "profile") {
        const profile = profileById.get(body.id);
        if (!profile || !["movie-night", "sports", "night", "gaming"].includes(profile.id)) {
          return json(response, 400, { error: "Profil ist für Automationen nicht freigegeben." });
        }
        try {
          return json(response, 200, await applyProfile(device, tv, profile));
        } catch (error) {
          if (error.responseBody) return json(response, error.statusCode || 409, error.responseBody);
          throw error;
        }
      }

      if (body.action === "favorite") {
        if (typeof body.id !== "string") return json(response, 400, { error: "Favorit fehlt." });
        const control = await addFavorites(device.id, controlView(await retryRead(() => tv.controlState())));
        if (!control.favorites.includes(body.id)) return json(response, 400, { error: "Ziel ist auf diesem Fernseher kein Favorit." });
        const choice = control.favoriteChoices.find(candidate => candidate.id === body.id);
        if (!choice) return json(response, 400, { error: "Favorit ist nicht verfügbar." });
        if (choice.type === "app") await tv.launchApp(choice.target);
        else {
          const input = control.inputs.find(candidate => candidate.id === choice.target);
          if (!input) return json(response, 400, { error: "Eingang ist nicht verfügbar." });
          await tv.launchApp(input.appId);
        }
        console.log(JSON.stringify({ event: "automation-action", at: new Date().toISOString(), device: device.id, action: body.action, target: body.id }));
        return json(response, 200, { ok: true, id: body.id, label: choice.label });
      }

      return json(response, 400, { error: "Automationsaktion ist nicht freigegeben." });
    }

    return json(response, 404, { error: "Nicht gefunden." });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: safeError(error) });
  }
}

async function api(request, response, url) {
  try {
    if (request.method === "GET" && url.pathname === "/api/devices") {
      return json(response, 200, { devices: deviceDefinitions.map(({ id, label }) => ({ id, label })), defaultDevice: deviceDefinitions[0].id });
    }

    const deviceId = url.searchParams.get("device") || deviceDefinitions[0].id;
    const device = deviceDefinitions.find(candidate => candidate.id === deviceId);
    const tv = tvClients.get(deviceId);
    if (!device || !tv) return json(response, 400, { error: "Unbekannter Fernseher." });

    if (request.method === "GET" && url.pathname === "/api/status") {
      return json(response, 200, { ...(await retryRead(() => tv.status())), id: device.id, label: device.label });
    }

    if (request.method === "GET" && url.pathname === "/api/settings") {
      const categories = [...new Set(settingsCatalog.map(setting => setting.category))];
      const values = Object.fromEntries(await Promise.all(categories.map(async category => [category, await retryRead(() => tv.getCategory(category))])));
      const settings = settingsCatalog.map(setting => ({
        ...setting,
        decode: undefined,
        encode: undefined,
        value: displayValue(setting, values[setting.category].settings[setting.key]),
        available: Object.hasOwn(values[setting.category].settings, setting.key)
      }));
      return json(response, 200, { settings });
    }

    if (request.method === "GET" && url.pathname === "/api/explorer") {
      const category = url.searchParams.get("category") || "general";
      if (!explorerCategories.includes(category)) return json(response, 400, { error: "Unbekannte Kategorie." });
      const value = await tv.getCategory(category);
      return json(response, 200, { category, dimension: value.dimension, settings: redactSettings(value.settings) });
    }

    if (request.method === "GET" && url.pathname === "/api/profiles") {
      return json(response, 200, { profiles: profilesCatalog });
    }

    if (request.method === "GET" && url.pathname === "/api/history") {
      const entries = await history.list(device.id, 12);
      const latest = entries.find(entry => !entry.undoneAt);
      return json(response, 200, { entries, undoableId: latest?.id || null });
    }

    if (request.method === "GET" && url.pathname === "/api/control") {
      return json(response, 200, await addFavorites(device.id, controlView(await retryRead(() => tv.controlState()))));
    }

    if (request.method === "POST" && url.pathname === "/api/preferences") {
      if (!sameOrigin(request)) return json(response, 403, { error: "Origin-Prüfung fehlgeschlagen." });
      const body = await readJson(request);
      const view = controlView(await tv.controlState());
      const allowed = new Set(favoriteChoices(view).map(choice => choice.id));
      if (!Array.isArray(body.favorites) || body.favorites.length > 8 || body.favorites.some(id => typeof id !== "string" || !allowed.has(id))) {
        return json(response, 400, { error: "Favoriten enthalten nicht erlaubte Ziele." });
      }
      const favorites = [...new Set(body.favorites)];
      await preferences.setFavorites(device.id, favorites);
      return json(response, 200, { favorites });
    }

    if (request.method === "GET" && url.pathname === "/api/maintenance") {
      const [status, launchPoints, stored, systemBackup] = await Promise.all([retryRead(() => tv.status()), retryRead(() => tv.launchPoints({ fresh: true })), preferences.get(device.id), systemBackups.latest(device.id)]);
      const homebrew = launchPoints.find(app => app.id === "org.webosbrew.hbchannel");
      return json(response, 200, {
        root: status.root,
        updatesBlocked: status.updatesBlocked,
        uptimeSeconds: status.device.uptimeSeconds,
        firmware: status.device.firmware,
        installedApps: launchPoints.length,
        homebrew: homebrew ? { installed: true, version: homebrew.version || "installiert" } : { installed: false },
        favorites: stored.favorites.length,
        backup: { available: true, scope: "allowlisted-settings-current-input" },
        systemBackup
      });
    }

    if (request.method === "POST" && url.pathname === "/api/system-backup") {
      if (!sameOrigin(request)) return json(response, 403, { error: "Origin-Prüfung fehlgeschlagen." });
      const stored = await preferences.get(device.id);
      const backup = await systemBackups.create(device, tv, stored);
      console.log(JSON.stringify({ event: "system-backup", at: backup.createdAt, device: device.id, bytes: backup.sizeBytes, files: backup.files, sha256: backup.sha256, verified: backup.verified }));
      return json(response, 201, { backup });
    }

    if (request.method === "GET" && url.pathname === "/api/backup") {
      const snapshot = await safeSettingsSnapshot(tv);
      const stored = await preferences.get(device.id);
      const body = {
        format: "lg-tv-control-backup-v1",
        createdAt: new Date().toISOString(),
        device: { id: device.id, label: device.label },
        ...snapshot,
        preferences: stored
      };
      const data = JSON.stringify(body, null, 2);
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="lg-tv-${device.id}-backup.json"`,
        "content-length": Buffer.byteLength(data),
        "cache-control": "no-store"
      });
      return response.end(data);
    }

    if (request.method === "POST" && url.pathname === "/api/backup/restore") {
      if (!sameOrigin(request)) return json(response, 403, { error: "Origin-Prüfung fehlgeschlagen." });
      const body = await readJson(request);
      const backup = body.backup;
      if (body.confirm !== "restore" || backup?.format !== "lg-tv-control-backup-v1" || backup?.device?.id !== device.id || !backup.settings || typeof backup.settings !== "object") {
        return json(response, 400, { error: "Backup, Gerät oder Bestätigung ist ungültig." });
      }
      const requested = Object.entries(backup.settings).map(([id, value]) => ({ setting: settingById.get(id), value }));
      if (!requested.length || requested.length > settingsCatalog.length || requested.some(item => !item.setting || !validateValue(item.setting, item.value))) {
        return json(response, 400, { error: "Backup enthält nicht erlaubte Einstellungswerte." });
      }
      const before = await safeSettingsSnapshot(tv);
      const changes = requested.filter(item => Object.hasOwn(before.settings, item.setting.id) && !Object.is(before.settings[item.setting.id], item.value)).map(item => ({ ...item, oldValue: before.settings[item.setting.id] }));
      const applied = [];
      try {
        for (const change of changes) {
          await tv.setSetting(change.setting.category, change.setting.key, encodedValue(change.setting, change.value));
          const after = await tv.getCategory(change.setting.category, { fresh: true });
          const actualValue = displayValue(change.setting, after.settings[change.setting.key]);
          if (!Object.is(actualValue, change.value)) throw new Error(`${change.setting.label} wurde vom TV nicht bestätigt.`);
          applied.push({ ...change, actualValue });
        }
      } catch (error) {
        for (const change of [...applied].reverse()) {
          try { await tv.setSetting(change.setting.category, change.setting.key, encodedValue(change.setting, change.oldValue)); } catch { /* best effort rollback is reported through the error */ }
        }
        return json(response, 409, { error: safeError(error), rolledBack: applied.length });
      }
      if (Array.isArray(backup.preferences?.favorites) && backup.preferences.configured !== false) {
        const view = controlView(await tv.controlState());
        const allowed = new Set(favoriteChoices(view).map(choice => choice.id));
        const favorites = [...new Set(backup.preferences.favorites)].filter(id => allowed.has(id)).slice(0, 8);
        await preferences.setFavorites(device.id, favorites);
      }
      const historyEntry = applied.length ? await history.append({
        device: device.id,
        type: "restore",
        label: "Konfigurationsbackup wiederhergestellt",
        changes: applied.map(change => ({ id: change.setting.id, label: change.setting.label, oldValue: change.oldValue, value: change.actualValue })),
        restartRequired: applied.some(change => change.setting.restartRequired)
      }) : null;
      return json(response, 200, { changed: applied.length, historyId: historyEntry?.id || null });
    }

    if (request.method === "GET" && url.pathname === "/api/control/icon") {
      const id = url.searchParams.get("id");
      if (!safeAppById.has(id)) return json(response, 404, { error: "Icon ist nicht freigegeben." });
      const icon = await tv.appIcon(id);
      response.writeHead(200, {
        "content-type": icon.type,
        "content-length": icon.data.length,
        "cache-control": "private, max-age=86400",
        "x-content-type-options": "nosniff"
      });
      return response.end(icon.data);
    }

    if (request.method === "POST" && url.pathname === "/api/control") {
      if (!sameOrigin(request)) return json(response, 403, { error: "Origin-Prüfung fehlgeschlagen." });
      const body = await readJson(request);
      const action = body.action;
      let result = { ok: true };

      if (action === "wake") {
        await sendWakeOnLan(device.mac, process.env.WOL_BROADCAST || "10.222.0.255");
      } else if (action === "launch") {
        if (typeof body.id !== "string" || !safeAppById.has(body.id)) return json(response, 400, { error: "App ist nicht freigegeben." });
        const view = controlView(await tv.controlState());
        if (!view.apps.some(app => app.id === body.id)) return json(response, 400, { error: "App ist auf diesem Fernseher nicht verfügbar." });
        await tv.launchApp(body.id);
        result = { ok: true, foregroundAppId: body.id, foregroundLabel: view.apps.find(app => app.id === body.id).label };
      } else if (action === "input") {
        const view = controlView(await tv.controlState());
        const input = view.inputs.find(candidate => candidate.id === body.id);
        if (!input) return json(response, 400, { error: "Eingang ist nicht freigegeben oder nicht verfügbar." });
        await tv.launchApp(input.appId);
        result = { ok: true, foregroundAppId: input.appId, foregroundLabel: input.label };
      } else if (action === "volume") {
        if (!Number.isInteger(body.value) || body.value < 0 || body.value > 100) return json(response, 400, { error: "Lautstärke muss zwischen 0 und 100 liegen." });
        const audio = await tv.setVolume(body.value);
        result = { ok: true, audio: { volume: audio.volume, muted: Boolean(audio.muted) } };
      } else if (action === "mute") {
        if (typeof body.value !== "boolean") return json(response, 400, { error: "Ungültiger Stumm-Wert." });
        const audio = await tv.setMute(body.value);
        result = { ok: true, audio: { volume: audio.volume, muted: Boolean(audio.muted) } };
      } else if (action === "button") {
        const button = safeRemoteButtonById.get(body.id);
        if (!button) return json(response, 400, { error: "Fernbedienungstaste ist nicht freigegeben." });
        await tv.sendRemoteButton(button.command);
      } else if (action === "pointer") {
        if (!["move", "click", "scroll"].includes(body.event)) return json(response, 400, { error: "Zeigerereignis ist nicht freigegeben." });
        const dx = Number(body.dx || 0);
        const dy = Number(body.dy || 0);
        if (!Number.isInteger(dx) || !Number.isInteger(dy) || Math.abs(dx) > 800 || Math.abs(dy) > 800) return json(response, 400, { error: "Zeigerbewegung ist außerhalb des erlaubten Bereichs." });
        await tv.sendPointer(body.event, { dx, dy });
      } else if (action === "text") {
        if (typeof body.value !== "string" || !body.value.trim() || body.value.length > 256 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body.value)) {
          return json(response, 400, { error: "Text muss zwischen 1 und 256 druckbare Zeichen enthalten." });
        }
        await tv.insertText(body.value);
      } else if (action === "screen-off" || action === "screen-on") {
        await tv.screen(action === "screen-on");
      } else if (action === "power-off" || action === "reboot") {
        if (body.confirm !== action) return json(response, 400, { error: "Bestätigung fehlt." });
        if (action === "power-off") await tv.powerOff();
        else await tv.reboot();
      } else {
        return json(response, 400, { error: "Unbekannte oder nicht erlaubte Aktion." });
      }

      console.log(JSON.stringify({ event: "control-action", at: new Date().toISOString(), device: device.id, action, target: typeof body.id === "string" ? body.id : undefined, value: action === "volume" ? body.value : undefined }));
      return json(response, 200, result);
    }

    if (request.method === "POST" && url.pathname === "/api/settings") {
      if (!sameOrigin(request)) return json(response, 403, { error: "Origin-Prüfung fehlgeschlagen." });
      const body = await readJson(request);
      const setting = settingById.get(body.id);
      if (!setting || !validateValue(setting, body.value)) return json(response, 400, { error: "Nicht erlaubte Einstellung oder Wert." });

      const before = await tv.getCategory(setting.category, { fresh: true });
      const oldValue = displayValue(setting, before.settings[setting.key]);
      await tv.setSetting(setting.category, setting.key, encodedValue(setting, body.value));
      const after = await tv.getCategory(setting.category, { fresh: true });
      const actualValue = displayValue(setting, after.settings[setting.key]);
      const verified = Object.is(actualValue, body.value);
      console.log(JSON.stringify({ event: "setting-change", at: new Date().toISOString(), device: device.id, id: setting.id, oldValue, requested: body.value, actualValue, verified }));
      let historyEntry = null;
      if (verified && !Object.is(oldValue, actualValue)) {
        historyEntry = await history.append({
          device: device.id,
          type: "setting",
          label: setting.label,
          changes: [{ id: setting.id, label: setting.label, oldValue, value: actualValue }],
          restartRequired: Boolean(setting.restartRequired)
        });
      }
      return json(response, verified ? 200 : 409, { id: setting.id, oldValue, value: actualValue, verified, historyId: historyEntry?.id || null });
    }

    if (request.method === "POST" && url.pathname === "/api/profiles/apply") {
      if (!sameOrigin(request)) return json(response, 403, { error: "Origin-Prüfung fehlgeschlagen." });
      const body = await readJson(request);
      const profile = profileById.get(body.id);
      if (!profile) return json(response, 400, { error: "Unbekanntes Profil." });

      try {
        return json(response, 200, await applyProfile(device, tv, profile));
      } catch (error) {
        if (error.responseBody) return json(response, error.statusCode || 409, error.responseBody);
        throw error;
      }
    }

    if (request.method === "POST" && url.pathname === "/api/history/undo") {
      if (!sameOrigin(request)) return json(response, 403, { error: "Origin-Prüfung fehlgeschlagen." });
      const body = await readJson(request);
      const entry = await history.latestUndoable(device.id);
      if (!entry || typeof body.id !== "string" || entry.id !== body.id) {
        return json(response, 409, { error: "Nur die jeweils letzte noch aktive Änderung kann rückgängig gemacht werden." });
      }

      const changes = entry.changes.map(change => ({ ...change, setting: settingById.get(change.id) }));
      if (changes.some(change => !change.setting || !validateValue(change.setting, change.oldValue) || !validateValue(change.setting, change.value))) {
        return json(response, 409, { error: "Der Verlauf enthält keine sicher wiederherstellbaren Werte." });
      }

      const categories = [...new Set(changes.map(change => change.setting.category))];
      const current = Object.fromEntries(await Promise.all(categories.map(async category => [category, await tv.getCategory(category, { fresh: true })])));
      const drifted = changes.filter(change => !Object.is(displayValue(change.setting, current[change.setting.category].settings[change.setting.key]), change.value));
      if (drifted.length) {
        return json(response, 409, { error: "Mindestens ein Wert wurde seitdem außerhalb des Dashboards geändert. Rückgängig wurde sicherheitshalber abgebrochen." });
      }

      const attempted = [];
      try {
        for (const change of [...changes].reverse()) {
          attempted.push(change);
          await tv.setSetting(change.setting.category, change.setting.key, encodedValue(change.setting, change.oldValue));
          const after = await tv.getCategory(change.setting.category, { fresh: true });
          if (!Object.is(displayValue(change.setting, after.settings[change.setting.key]), change.oldValue)) {
            throw new Error(`${change.setting.label} wurde vom TV nicht bestätigt.`);
          }
        }
      } catch (error) {
        const rollback = [];
        for (const change of [...attempted].reverse()) {
          try {
            await tv.setSetting(change.setting.category, change.setting.key, encodedValue(change.setting, change.value));
            const after = await tv.getCategory(change.setting.category, { fresh: true });
            rollback.push({ id: change.id, restored: Object.is(displayValue(change.setting, after.settings[change.setting.key]), change.value) });
          } catch {
            rollback.push({ id: change.id, restored: false });
          }
        }
        console.error(JSON.stringify({ event: "history-undo-rollback", at: new Date().toISOString(), device: device.id, historyId: entry.id, rollback }));
        return json(response, 409, { error: safeError(error), rollback });
      }

      await history.markUndone(device.id, entry.id);
      console.log(JSON.stringify({ event: "history-undo", at: new Date().toISOString(), device: device.id, historyId: entry.id, changes: changes.map(change => change.id) }));
      return json(response, 200, { id: entry.id, changed: changes.map(change => ({ id: change.id, value: change.oldValue })), restartRequired: Boolean(entry.restartRequired) });
    }

    return json(response, 404, { error: "Nicht gefunden." });
  } catch (error) {
    console.error(error);
    return json(response, 503, { error: safeError(error) });
  }
}

const server = createServer(async (request, response) => {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("content-security-policy", "default-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:");

  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (url.pathname.startsWith("/api/automation/")) {
    if (!automationAuthenticated(request)) return json(response, 401, { error: "Automatisierungsauthentifizierung erforderlich." });
    return automationApi(request, response, url);
  }

  if (!authenticated(request)) {
    response.writeHead(401, { "www-authenticate": 'Basic realm="LG TV Control", charset="UTF-8"' });
    return response.end("Authentifizierung erforderlich");
  }

  if (url.pathname.startsWith("/api/")) return api(request, response, url);

  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  if (!/^[a-zA-Z0-9._/-]+$/.test(requested) || requested.includes("..")) {
    response.writeHead(400);
    return response.end("Ungültiger Pfad");
  }
  const file = join(publicDir, requested);
  if (!existsSync(file)) {
    response.writeHead(404);
    return response.end("Nicht gefunden");
  }
  const stat = await readFile(file);
  response.writeHead(200, { "content-type": mimeTypes[extname(file)] || "application/octet-stream", "content-length": stat.length });
  createReadStream(file).pipe(response);
});

server.listen(port, "0.0.0.0", () => console.log(`LG TV Control listening on http://0.0.0.0:${port}`));
