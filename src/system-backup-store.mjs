import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

const allowedRoots = [
  "var/luna/preferences/",
  "var/lib/webosbrew/",
  "media/developer/apps/usr/palm/applications/",
  "media/developer/apps/usr/palm/services/",
  "var/palm/data/",
  "home/root/.ssh/authorized_keys"
];

function tarString(block, start, length) {
  const end = block.indexOf(0, start);
  return block.subarray(start, end >= start && end < start + length ? end : start + length).toString("utf8");
}

function tarNumber(block, start, length) {
  const value = tarString(block, start, length).trim();
  return value ? Number.parseInt(value, 8) : 0;
}

export function inspectConfigArchive(archive) {
  if (!Buffer.isBuffer(archive) || archive.length < 64) throw new Error("Das TV-Archiv ist leer oder ungültig.");
  const tar = gunzipSync(archive, { maxOutputLength: 96 * 1024 * 1024 });
  const entries = [];
  let longName = null;
  let longLink = null;
  for (let offset = 0; offset + 512 <= tar.length;) {
    const block = tar.subarray(offset, offset + 512);
    if (block.every(byte => byte === 0)) break;
    const prefix = tarString(block, 345, 155);
    const size = tarNumber(block, 124, 12);
    const type = String.fromCharCode(block[156] || 48);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error("Das TV-Archiv enthält einen ungültigen TAR-Eintrag.");
    const dataStart = offset + 512;
    const data = tar.subarray(dataStart, dataStart + size);
    const rawName = `${prefix}${prefix ? "/" : ""}${tarString(block, 0, 100)}`;
    if (rawName === "././@LongLink" && (type === "L" || type === "K")) {
      const nullIndex = data.indexOf(0);
      const value = data.subarray(0, nullIndex >= 0 ? nullIndex : data.length).toString("utf8");
      if (!value) throw new Error("Das TV-Archiv enthält ungültige LongLink-Metadaten.");
      if (type === "L") longName = value;
      else longLink = value;
      offset += 512 + Math.ceil(size / 512) * 512;
      continue;
    }
    const name = (longName || rawName).replace(/^\.\//, "");
    const linkName = longLink || tarString(block, 157, 100);
    longName = null;
    longLink = null;
    if (!name || !["0", "5", "2"].includes(type)) throw new Error("Das TV-Archiv enthält einen nicht unterstützten TAR-Eintrag.");
    if (name.startsWith("/") || name.split("/").includes("..") || !allowedRoots.some(root => name === root.slice(0, -1) || name.startsWith(root))) {
      throw new Error("Das TV-Archiv enthält einen nicht freigegebenen Pfad.");
    }
    if (type === "2" && (!linkName || linkName.includes("\0"))) throw new Error("Das TV-Archiv enthält einen ungültigen symbolischen Link.");
    entries.push({ name, size, type, ...(type === "2" ? { linkName } : {}) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (longName || longLink) throw new Error("Das TV-Archiv enthält unvollständige LongLink-Metadaten.");
  const symlinks = entries.filter(entry => entry.type === "2").map(entry => entry.name.replace(/\/$/, ""));
  if (entries.some(entry => symlinks.some(link => entry.name !== link && entry.name.startsWith(`${link}/`)))) {
    throw new Error("Das TV-Archiv schreibt durch einen symbolischen Link.");
  }
  if (!entries.some(entry => entry.name.startsWith("var/luna/preferences/")) || !entries.some(entry => entry.name.startsWith("var/lib/webosbrew/"))) {
    throw new Error("Das TV-Archiv enthält nicht alle erforderlichen Konfigurationsbereiche.");
  }
  return entries;
}

function publicMetadata(manifest) {
  if (!manifest) return null;
  return {
    createdAt: manifest.createdAt,
    sizeBytes: manifest.archive.sizeBytes,
    sha256: manifest.archive.sha256,
    files: manifest.archive.files,
    verified: manifest.archive.verified,
    firmware: manifest.device.firmware,
    model: manifest.device.model
  };
}

export class SystemBackupStore {
  constructor(root) {
    this.root = root;
    this.queues = new Map();
  }

  serialize(deviceId, operation) {
    const queue = this.queues.get(deviceId) || Promise.resolve();
    const result = queue.then(operation, operation);
    this.queues.set(deviceId, result.catch(() => {}));
    return result;
  }

  create(device, tv, dashboardPreferences) {
    return this.serialize(device.id, async () => {
      if (!/^[a-z0-9-]+$/.test(device.id)) throw new Error("Ungültige Gerätekennung.");
      const createdAt = new Date().toISOString();
      const timestamp = createdAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
      const directory = join(this.root, device.id);
      await mkdir(directory, { recursive: true, mode: 0o700 });

      const status = await tv.status();
      if (!status.root) throw new Error("Root-Zugriff ist für die Gerätesicherung erforderlich.");
      const archive = await tv.configArchive();
      const entries = inspectConfigArchive(archive);
      const sha256 = createHash("sha256").update(archive).digest("hex");
      const baseName = `${timestamp}-${device.id}`;
      const archiveName = `${baseName}.tar.gz`;
      const manifestName = `${baseName}.json`;
      const archivePath = join(directory, archiveName);
      const temporaryArchive = `${archivePath}.${process.pid}.tmp`;
      await writeFile(temporaryArchive, archive, { mode: 0o600 });
      await rename(temporaryArchive, archivePath);

      const persisted = await readFile(archivePath);
      const persistedHash = createHash("sha256").update(persisted).digest("hex");
      const persistedEntries = inspectConfigArchive(persisted);
      if (persistedHash !== sha256 || persistedEntries.length !== entries.length) throw new Error("Die gespeicherte Sicherung konnte nicht verifiziert werden.");

      const manifest = {
        format: "lg-tv-system-backup-v1",
        createdAt,
        device: {
          id: device.id,
          label: device.label,
          model: status.device.model,
          firmware: status.device.firmware,
          product: status.device.product,
          sdk: status.device.sdk,
          board: status.device.board,
          hostname: status.device.hostname,
          kernel: status.device.kernel
        },
        archive: { file: archiveName, sizeBytes: persisted.length, sha256, files: persistedEntries.length, verified: true },
        scope: [...allowedRoots],
        dashboardPreferences,
        restore: {
          automatic: false,
          note: "Nur nach Prüfung von Modell und Firmware manuell wiederherstellen. Geräteschlüssel niemals auf einen anderen TV übertragen."
        }
      };
      const manifestPath = join(directory, manifestName);
      const temporaryManifest = `${manifestPath}.${process.pid}.tmp`;
      await writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
      await rename(temporaryManifest, manifestPath);
      return publicMetadata(manifest);
    });
  }

  async latest(deviceId) {
    if (!/^[a-z0-9-]+$/.test(deviceId)) return null;
    try {
      const directory = join(this.root, deviceId);
      const manifests = (await readdir(directory)).filter(name => /^\d{8}T\d{6}Z-[a-z0-9-]+\.json$/.test(name)).sort().reverse();
      if (!manifests.length) return null;
      const manifest = JSON.parse(await readFile(join(directory, manifests[0]), "utf8"));
      return manifest?.format === "lg-tv-system-backup-v1" ? publicMetadata(manifest) : null;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
}
