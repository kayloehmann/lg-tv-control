import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { inspectConfigArchive, SystemBackupStore } from "../src/system-backup-store.mjs";

function tarOctal(value, width) {
  return `${value.toString(8).padStart(width - 1, "0")}\0`;
}

function tarBlocks(entries) {
  const blocks = [];
  for (const [name, contentValue, type = "0"] of entries) {
    const content = Buffer.from(contentValue);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, "utf8");
    header.write(tarOctal(0o600, 8), 100, 8, "ascii");
    header.write(tarOctal(0, 8), 108, 8, "ascii");
    header.write(tarOctal(0, 8), 116, 8, "ascii");
    header.write(tarOctal(content.length, 12), 124, 12, "ascii");
    header.write(tarOctal(0, 12), 136, 12, "ascii");
    header.fill(0x20, 148, 156);
    header.write(type, 156, 1, "ascii");
    header.write("ustar\0", 257, 6, "ascii");
    header.write(tarOctal(header.reduce((sum, byte) => sum + byte, 0), 8), 148, 8, "ascii");
    blocks.push(header, content, Buffer.alloc((512 - content.length % 512) % 512));
  }
  return blocks;
}

function tar(entries) {
  const blocks = tarBlocks(entries);
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

const validArchive = () => tar([
  ["var/luna/preferences/general", "{}"],
  ["var/lib/webosbrew/startup.sh", "#!/bin/sh\n"],
  ["home/root/.ssh/authorized_keys", "ssh-ed25519 test"]
]);

test("system backup archive accepts only the fixed configuration roots", () => {
  assert.equal(inspectConfigArchive(validArchive()).length, 3);
  assert.throws(() => inspectConfigArchive(tar([
    ["var/luna/preferences/general", "{}"],
    ["var/lib/webosbrew/startup.sh", "x"],
    ["etc/shadow", "secret"]
  ])), /nicht freigegebenen Pfad/);
});

test("system backup archive resolves GNU long names before applying the allowlist", () => {
  const longAllowed = `media/developer/apps/usr/palm/applications/org.webosbrew.hbchannel/${"nested/".repeat(12)}icon.png`;
  const archive = gzipSync(Buffer.concat([
    ...tarBlocks([
      ["var/luna/preferences/general", "{}"],
      ["var/lib/webosbrew/startup.sh", "x"],
      ["././@LongLink", `${longAllowed}\0`, "L"],
      [longAllowed.slice(0, 100), "image"]
    ]),
    Buffer.alloc(1024)
  ]));
  assert.equal(inspectConfigArchive(archive).at(-1).name, longAllowed);

  const escaped = gzipSync(Buffer.concat([
    ...tarBlocks([
      ["var/luna/preferences/general", "{}"],
      ["var/lib/webosbrew/startup.sh", "x"],
      ["././@LongLink", "../../etc/shadow\0", "L"],
      ["placeholder", "secret"]
    ]),
    Buffer.alloc(1024)
  ]));
  assert.throws(() => inspectConfigArchive(escaped), /nicht freigegebenen Pfad/);
});

test("system backup is persisted with a verified manifest and restrictive modes", async () => {
  const root = await mkdtemp(join(tmpdir(), "lg-tv-backup-"));
  const tv = {
    status: async () => ({ root: true, device: { model: "TEST-TV", firmware: "1.2.3", product: "webOS", sdk: "3", board: "test", hostname: "tv", kernel: "Linux" } }),
    configArchive: async () => validArchive()
  };
  try {
    const store = new SystemBackupStore(root);
    const saved = await store.create({ id: "living-room", label: "Wohnzimmer" }, tv, { favorites: [] });
    assert.equal(saved.verified, true);
    assert.equal(saved.files, 3);
    const files = await import("node:fs/promises").then(fs => fs.readdir(join(root, "living-room")));
    assert.equal(files.length, 2);
    for (const file of files) assert.equal((await stat(join(root, "living-room", file))).mode & 0o777, 0o600);
    const manifestName = files.find(file => file.endsWith(".json"));
    const manifest = JSON.parse(await readFile(join(root, "living-room", manifestName), "utf8"));
    assert.equal(manifest.archive.sha256, saved.sha256);
    assert.equal((await store.latest("living-room")).sha256, saved.sha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("retention removes only old verified pairs and preserves incomplete data", async () => {
  const root = await mkdtemp(join(tmpdir(), "lg-tv-retention-"));
  const directory = join(root, "living-room");
  const archive = validArchive();
  const sha256 = createHash("sha256").update(archive).digest("hex");
  try {
    await mkdir(directory);
    for (let index = 1; index <= 3; index += 1) {
      const stamp = `2026010${index}T010101Z`;
      const archiveName = `${stamp}-living-room.tar.gz`;
      const manifest = {
        format: "lg-tv-system-backup-v1",
        createdAt: `2026-01-0${index}T01:01:01.000Z`,
        device: { id: "living-room", model: "TEST", firmware: "1" },
        archive: { file: archiveName, sha256, sizeBytes: archive.length, files: 3, verified: true }
      };
      await writeFile(join(directory, archiveName), archive, { mode: 0o600 });
      await writeFile(join(directory, `${stamp}-living-room.json`), JSON.stringify(manifest), { mode: 0o600 });
    }
    await writeFile(join(directory, "20251231T010101Z-living-room.tar.gz"), archive, { mode: 0o600 });
    const result = await new SystemBackupStore(root).prune("living-room", { keep: 2 });
    assert.deepEqual(result, { kept: 2, removed: 1, preservedInvalid: 0 });
    const names = await readdir(directory);
    assert.equal(names.some(name => name.startsWith("20260101T010101Z")), false);
    assert.equal(names.includes("20251231T010101Z-living-room.tar.gz"), true);
    assert.equal(names.filter(name => name.endsWith(".json")).length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
