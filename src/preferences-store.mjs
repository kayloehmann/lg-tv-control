import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class PreferencesStore {
  constructor(path) {
    this.path = path;
    this.queue = Promise.resolve();
  }

  async readAll() {
    try {
      const value = JSON.parse(await readFile(this.path, "utf8"));
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch (error) {
      if (error.code === "ENOENT") return {};
      throw error;
    }
  }

  async get(device) {
    await this.queue;
    const all = await this.readAll();
    const favorites = all[device]?.favorites;
    return { favorites: Array.isArray(favorites) ? favorites : [], configured: Array.isArray(favorites) };
  }

  setFavorites(device, favorites) {
    const operation = async () => {
      const all = await this.readAll();
      all[device] = { ...(all[device] || {}), favorites };
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.path);
      return { favorites };
    };
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => {});
    return result;
  }
}
