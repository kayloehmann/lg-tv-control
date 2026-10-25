import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class HistoryStore {
  constructor(path, { maxEntries = 100 } = {}) {
    this.path = path;
    this.maxEntries = maxEntries;
    this.queue = Promise.resolve();
  }

  async read() {
    try {
      const entries = JSON.parse(await readFile(this.path, "utf8"));
      return Array.isArray(entries) ? entries : [];
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async write(entries) {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.path);
  }

  serialize(operation) {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => {});
    return result;
  }

  async list(device, limit = 10) {
    await this.queue;
    const entries = await this.read();
    return entries.filter(entry => entry.device === device).slice(0, limit);
  }

  append(entry) {
    return this.serialize(async () => {
      const entries = await this.read();
      const saved = {
        id: randomUUID(),
        at: new Date().toISOString(),
        undoneAt: null,
        ...entry
      };
      entries.unshift(saved);
      await this.write(entries.slice(0, this.maxEntries));
      return saved;
    });
  }

  async latestUndoable(device) {
    return (await this.list(device, this.maxEntries)).find(entry => !entry.undoneAt) || null;
  }

  markUndone(device, id) {
    return this.serialize(async () => {
      const entries = await this.read();
      const latest = entries.find(entry => entry.device === device && !entry.undoneAt);
      if (!latest || latest.id !== id) return null;
      latest.undoneAt = new Date().toISOString();
      await this.write(entries);
      return latest;
    });
  }
}
