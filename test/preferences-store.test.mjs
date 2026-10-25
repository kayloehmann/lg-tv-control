import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PreferencesStore } from "../src/preferences-store.mjs";

test("preferences are persisted separately per device", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lg-tv-preferences-"));
  const path = join(directory, "preferences.json");
  const store = new PreferencesStore(path);
  await store.setFavorites("living-room", ["app:netflix", "input:HDMI_2"]);
  await store.setFavorites("bedroom", ["app:com.apple.appletv"]);
  assert.deepEqual((await store.get("living-room")).favorites, ["app:netflix", "input:HDMI_2"]);
  assert.deepEqual((await store.get("bedroom")).favorites, ["app:com.apple.appletv"]);
  assert.equal((await readFile(path, "utf8")).includes("living-room"), true);
});

test("an explicitly empty favorite list stays empty", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lg-tv-empty-preferences-"));
  const store = new PreferencesStore(join(directory, "preferences.json"));
  assert.equal((await store.get("living-room")).configured, false);
  await store.setFavorites("living-room", []);
  assert.deepEqual(await store.get("living-room"), { favorites: [], configured: true });
});
