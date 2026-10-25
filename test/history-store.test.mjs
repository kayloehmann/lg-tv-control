import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { HistoryStore } from "../src/history-store.mjs";

test("history is separated per device and supports stack-like undo", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lg-tv-history-"));
  try {
    const store = new HistoryStore(join(directory, "history.json"));
    const first = await store.append({ device: "living-room", type: "setting", label: "A", changes: [] });
    const second = await store.append({ device: "living-room", type: "setting", label: "B", changes: [] });
    await store.append({ device: "bedroom", type: "setting", label: "C", changes: [] });

    assert.deepEqual((await store.list("living-room")).map(entry => entry.label), ["B", "A"]);
    assert.equal((await store.latestUndoable("living-room")).id, second.id);
    assert.equal(await store.markUndone("living-room", first.id), null);
    assert.equal((await store.markUndone("living-room", second.id)).id, second.id);
    assert.equal((await store.latestUndoable("living-room")).id, first.id);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("history keeps only the configured maximum", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lg-tv-history-"));
  try {
    const store = new HistoryStore(join(directory, "history.json"), { maxEntries: 2 });
    await store.append({ device: "living-room", label: "A", changes: [] });
    await store.append({ device: "living-room", label: "B", changes: [] });
    await store.append({ device: "living-room", label: "C", changes: [] });
    assert.deepEqual((await store.list("living-room")).map(entry => entry.label), ["C", "B"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
