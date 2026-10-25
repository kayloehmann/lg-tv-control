import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
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
