import { mkdir, readFile, rename, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PreferencesStore } from "./preferences-store.mjs";
import { SystemBackupStore } from "./system-backup-store.mjs";
import { TvClient } from "./tv-client.mjs";

const backupRoot = process.env.SYSTEM_BACKUP_DIR || "/data/backups";
const commonTvConfig = {
  port: Number(process.env.TV_SSH_PORT || 22),
  user: process.env.TV_SSH_USER || "root",
  keyPath: process.env.TV_SSH_KEY_PATH || "/run/secrets/tv_ssh_key",
  knownHostsPath: process.env.TV_KNOWN_HOSTS_PATH || "/run/secrets/known_hosts"
};
const devices = [
  { id: "living-room", label: "Wohnzimmer", host: process.env.TV_HOST || "10.222.0.83" },
  { id: "bedroom", label: "Schlafzimmer", host: process.env.BEDROOM_TV_HOST || "10.222.0.96" }
];
const preferences = new PreferencesStore(process.env.PREFERENCES_PATH || "/data/preferences.json");
const backups = new SystemBackupStore(backupRoot);
const lockDirectory = join(backupRoot, ".daily-backup.lock");
const statusPath = join(backupRoot, "last-daily-run.json");

await mkdir(backupRoot, { recursive: true, mode: 0o700 });
try {
  await mkdir(lockDirectory, { mode: 0o700 });
} catch (error) {
  if (error.code === "EEXIST") {
    console.error(JSON.stringify({ event: "daily-system-backup", ok: false, error: "Ein Sicherungslauf ist bereits aktiv." }));
    process.exit(2);
  }
  throw error;
}

const startedAt = new Date().toISOString();
const results = [];
try {
  for (const device of devices) {
    try {
      const tv = new TvClient({ ...commonTvConfig, host: device.host });
      const saved = await backups.create(device, tv, await preferences.get(device.id));
      const retention = await backups.prune(device.id, { keep: 30 });
      results.push({ device: device.id, ok: true, backup: saved, retention });
    } catch (error) {
      results.push({ device: device.id, ok: false, error: error instanceof Error ? error.message.replaceAll(device.host, "TV") : "Unbekannter Fehler" });
    }
  }
  const status = { format: "lg-tv-daily-backup-status-v1", startedAt, finishedAt: new Date().toISOString(), ok: results.every(result => result.ok), results };
  const temporary = `${statusPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, statusPath);
  console.log(JSON.stringify(status));
  if (!status.ok) process.exitCode = 1;
} finally {
  await rmdir(lockDirectory).catch(() => {});
}
