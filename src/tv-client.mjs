import { spawn } from "node:child_process";

const ansiPattern = /\u001b\[[0-?]*[ -/]*[@-~]/g;

export function parseLunaResponse(output) {
  const clean = output.replace(ansiPattern, "");
  const candidates = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) candidates.push(clean.slice(start, index + 1));
    }
  }

  for (const candidate of candidates.reverse()) {
    try { return JSON.parse(candidate); } catch { /* try the preceding object */ }
  }
  throw new Error("Der TV lieferte keine lesbare JSON-Antwort.");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

export class TvClient {
  constructor(config) {
    this.config = config;
    this.cache = new Map();
    this.iconCache = new Map();
    this.queue = Promise.resolve();
  }

  runSsh(remoteCommand, timeoutMs = 12000) {
    const job = this.queue.then(() => this.executeSsh(remoteCommand, timeoutMs));
    this.queue = job.catch(() => undefined);
    return job;
  }

  runSshBuffer(remoteCommand, { timeoutMs = 60000, maxBytes = 32 * 1024 * 1024 } = {}) {
    const job = this.queue.then(() => this.executeSshBuffer(remoteCommand, timeoutMs, maxBytes));
    this.queue = job.catch(() => undefined);
    return job;
  }

  executeSsh(remoteCommand, timeoutMs = 12000) {
    const { host, port, user, keyPath, knownHostsPath } = this.config;
    const args = [
      "-tt", "-p", String(port), "-i", keyPath,
      "-o", "BatchMode=yes", "-o", "PasswordAuthentication=no",
      "-o", "HostKeyAlgorithms=ssh-ed25519",
      "-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${knownHostsPath}`,
      "-o", "ConnectTimeout=6", `${user}@${host}`, remoteCommand
    ];

    return new Promise((resolve, reject) => {
      const child = spawn("ssh", args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error("Zeitüberschreitung beim Zugriff auf den TV."));
      }, timeoutMs);
      child.stdout.on("data", data => { stdout += data; });
      child.stderr.on("data", data => { stderr += data; });
      child.on("error", error => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", code => {
        clearTimeout(timer);
        if (code === 0) resolve({ stdout, stderr });
        else reject(new Error(stderr.trim() || `SSH wurde mit Status ${code} beendet.`));
      });
    });
  }

  executeSshBuffer(remoteCommand, timeoutMs, maxBytes) {
    const { host, port, user, keyPath, knownHostsPath } = this.config;
    const args = [
      "-T", "-p", String(port), "-i", keyPath,
      "-o", "BatchMode=yes", "-o", "PasswordAuthentication=no",
      "-o", "HostKeyAlgorithms=ssh-ed25519",
      "-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${knownHostsPath}`,
      "-o", "ConnectTimeout=6", `${user}@${host}`, remoteCommand
    ];

    return new Promise((resolve, reject) => {
      const child = spawn("ssh", args, { stdio: ["ignore", "pipe", "pipe"] });
      const chunks = [];
      let size = 0;
      let stderr = "";
      let settled = false;
      const finish = callback => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        callback();
      };
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish(() => reject(new Error("Zeitüberschreitung beim Erstellen der TV-Sicherung.")));
      }, timeoutMs);
      child.stdout.on("data", data => {
        size += data.length;
        if (size > maxBytes) {
          child.kill("SIGTERM");
          finish(() => reject(new Error("Die TV-Sicherung überschreitet das erlaubte Größenlimit.")));
          return;
        }
        chunks.push(data);
      });
      child.stderr.on("data", data => { stderr += data; });
      child.on("error", error => finish(() => reject(error)));
      child.on("close", code => finish(() => {
        if (code === 0) resolve(Buffer.concat(chunks, size));
        else reject(new Error(stderr.trim() || `SSH wurde mit Status ${code} beendet.`));
      }));
    });
  }

  async luna(method, payload) {
    return this.lunaUri(`luna://com.webos.settingsservice/${method}`, payload);
  }

  async lunaUri(uri, payload, timeoutMs = 12000) {
    const command = [
      "luna-send", "-d", "-a", "webosbrew", "-f", "-n", "1", "-w", "6000",
      shellQuote(uri), shellQuote(JSON.stringify(payload))
    ].join(" ");
    const { stdout } = await this.runSsh(command, timeoutMs);
    const response = parseLunaResponse(stdout);
    if (response.returnValue === false) throw new Error(response.errorText || "TV-Anfrage fehlgeschlagen.");
    return response;
  }

  async audioStatus() {
    const services = this.audioService ? [this.audioService] : ["com.webos.service.audio", "com.webos.audio"];
    let lastError;
    for (const service of services) {
      try {
        const status = await this.lunaUri(`luna://${service}/getVolume`, {});
        this.audioService = service;
        return status;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  async controlState() {
    const foreground = await this.lunaUri("luna://com.webos.applicationManager/getForegroundAppInfo", {});
    const launchPoints = await this.launchPoints();
    const inputs = await this.lunaUri("luna://com.webos.service.eim/getAllInputStatus", {});
    const power = await this.lunaUri("luna://com.webos.service.tvpower/power/getPowerState", {});
    let remoteAvailable = false;
    try {
      await this.pointerSocket();
      remoteAvailable = true;
    } catch { /* older or restricted webOS builds may not expose network input */ }
    let audio = null;
    try { audio = await this.audioStatus(); } catch { /* some output modes expose no master volume */ }
    return {
      foregroundAppId: foreground.appId || null,
      launchPoints,
      inputs: inputs.devices || [],
      powerState: power.state || "Unknown",
      remoteAvailable,
      audio: audio ? { volume: audio.volume, muted: Boolean(audio.muted) } : null
    };
  }

  async pointerSocket() {
    const response = await this.lunaUri("luna://com.webos.service.networkinput/getPointerInputSocket", {});
    const socketPath = response.socketPath || "";
    if (!/^\/tmp\/netinput\.[A-Za-z0-9._-]+\.sock$/.test(socketPath)) throw new Error("Ungültiger Eingabekanal des TVs.");
    return socketPath;
  }

  async sendRemoteButton(command) {
    return this.sendNetworkInput(`type:button\nname:${command}\n\n`);
  }

  async sendNetworkInput(payload) {
    const socketPath = await this.pointerSocket();
    const script = [
      'var net = require("net")',
      'var socket = net.connect(process.argv[1])',
      'socket.setTimeout(3000)',
      'socket.once("connect", function () { socket.end(process.argv[2]) })',
      'socket.once("timeout", function () { socket.destroy(); process.exitCode = 2 })',
      'socket.once("error", function (error) { console.error(error.message); process.exitCode = 1 })'
    ].join(";");
    await this.runSsh(`node -e ${shellQuote(script)} ${shellQuote(socketPath)} ${shellQuote(payload)}`, 8000);
  }

  sendPointer(event, { dx = 0, dy = 0 } = {}) {
    if (event === "click") return this.sendNetworkInput("type:click\n\n");
    if (event === "move") return this.sendNetworkInput(`type:move\ndx:${dx}\ndy:${dy}\ndown:0\n\n`);
    if (event === "scroll") return this.sendNetworkInput(`type:scroll\ndx:0\ndy:${dy}\n\n`);
    throw new Error("Unbekanntes Zeigerereignis.");
  }

  insertText(text) {
    return this.lunaUri("luna://com.webos.service.ime/insertText", { text, replace: 0 });
  }

  async launchPoints({ fresh = false } = {}) {
    if (!fresh && this.launchPointsCache && Date.now() - this.launchPointsCache.at < 30_000) return this.launchPointsCache.value;
    if (!fresh && this.launchPointsPromise) return this.launchPointsPromise;
    this.launchPointsPromise = this.lunaUri("luna://com.webos.applicationManager/listLaunchPoints", {})
      .then(response => {
        const value = response.launchPoints || [];
        this.launchPointsCache = { at: Date.now(), value };
        return value;
      })
      .finally(() => { this.launchPointsPromise = null; });
    return this.launchPointsPromise;
  }

  async appIcon(id) {
    const cached = this.iconCache.get(id);
    if (cached) return cached;
    const app = (await this.launchPoints()).find(candidate => candidate.id === id);
    const path = app?.largeIcon || app?.icon || (id === "com.webos.app.livetv" ? "/usr/palm/applications/com.webos.app.livetv/assets/icon_antenna.png" : "");
    if (!/^\/(?:usr\/palm\/applications|media\/(?:cryptofs|developer)\/apps\/usr\/palm\/applications)\/[A-Za-z0-9._/+ -]+$/.test(path) || path.includes("..")) {
      throw new Error("Iconpfad ist nicht freigegeben.");
    }
    const { stdout } = await this.runSsh(`base64 ${shellQuote(path)}`);
    const data = Buffer.from(stdout.replace(/\s/g, ""), "base64");
    if (!data.length || data.length > 1_000_000) throw new Error("Icondatei ist ungültig.");
    const value = { data, type: /\.jpe?g$/i.test(path) ? "image/jpeg" : "image/png" };
    this.iconCache.set(id, value);
    return value;
  }

  launchApp(id) {
    return this.lunaUri("luna://com.webos.applicationManager/launch", { id });
  }

  async setVolume(volume) {
    await this.audioStatus();
    await this.lunaUri(`luna://${this.audioService}/setVolume`, { volume });
    return this.audioStatus();
  }

  async setMute(mute) {
    await this.audioStatus();
    await this.lunaUri(`luna://${this.audioService}/setMute`, { mute });
    return this.audioStatus();
  }

  screen(on) {
    return this.lunaUri(`luna://com.webos.service.tvpower/power/${on ? "turnOnScreen" : "turnOffScreen"}`, {});
  }

  powerOff() {
    return this.lunaUri("luna://com.webos.service.tvpower/power/powerOff", {});
  }

  reboot() {
    return this.lunaUri("luna://com.webos.service.tvpower/power/reboot", {});
  }

  configArchive() {
    const paths = [
      "var/luna/preferences",
      "var/lib/webosbrew",
      "media/developer/apps/usr/palm/applications",
      "media/developer/apps/usr/palm/services",
      "var/palm/data",
      "home/root/.ssh/authorized_keys"
    ];
    return this.runSshBuffer(`tar -czf - -C / ${paths.map(shellQuote).join(" ")}`);
  }

  async getCategory(category, { fresh = false } = {}) {
    const cached = this.cache.get(category);
    if (!fresh && cached && Date.now() - cached.at < 5000) return cached.value;
    const response = await this.luna("getSystemSettings", { category });
    const value = { settings: response.settings ?? {}, dimension: response.dimension ?? null };
    this.cache.set(category, { at: Date.now(), value });
    return value;
  }

  async setSetting(category, key, value) {
    const response = await this.luna("setSystemSettings", { category, settings: { [key]: value } });
    this.cache.delete(category);
    return response;
  }

  async status() {
    const systemPayload = shellQuote(JSON.stringify({
      keys: ["modelName", "firmwareVersion", "UHD", "sdkVersion", "boardType"]
    }));
    const command = [
      "id",
      "test -e /var/luna/preferences/webosbrew_block_updates && echo updates:block || echo updates:allow",
      "echo __HOST__", "hostname",
      "echo __KERNEL__", "uname -sr",
      "echo __UPTIME__", "cut -d' ' -f1 /proc/uptime",
      "echo __SYSTEM__", `luna-send -n 1 -f luna://com.webos.service.tv.systemproperty/getSystemInfo ${systemPayload}`,
      "echo __UPDATE__", "luna-send -n 1 -f luna://com.webos.service.update/getCurrentSWInformation '{}'"
    ].join("; ");
    const { stdout } = await this.runSsh(command);
    const section = (start, end) => stdout.split(start)[1]?.split(end)[0] ?? "";
    const system = parseLunaResponse(section("__SYSTEM__", "__UPDATE__"));
    const update = parseLunaResponse(stdout.split("__UPDATE__")[1] ?? "");
    const lineAfter = marker => stdout.split(marker)[1]?.trim().split(/\r?\n/)[0]?.trim() ?? "";
    return {
      online: true,
      root: /uid=0\(root\)/.test(stdout),
      updatesBlocked: /updates:block/.test(stdout),
      host: this.config.host,
      device: {
        model: system.modelName || update.model_name || "Unbekannt",
        firmware: system.firmwareVersion || [update.major_ver, update.minor_ver].filter(Boolean).join(".") || "Unbekannt",
        product: update.product_name || "webOS TV",
        sdk: system.sdkVersion || "Unbekannt",
        board: system.boardType || "Unbekannt",
        uhd: system.UHD === "true" || system.UHD === true,
        hostname: lineAfter("__HOST__"),
        kernel: lineAfter("__KERNEL__"),
        uptimeSeconds: Math.floor(Number(lineAfter("__UPTIME__")) || 0)
      }
    };
  }
}
