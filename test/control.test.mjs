import assert from "node:assert/strict";
import test from "node:test";
import { allowedApps, allowedInputs, allowedRemoteButtons, safeRemoteButtonById } from "../src/control-catalog.mjs";
import { wakePacket } from "../src/wol.mjs";

test("control catalog exposes only explicitly safe installed apps", () => {
  const apps = allowedApps([
    { id: "netflix", title: "Netflix" },
    { id: "com.webos.app.settings", title: "Einstellungen" },
    { id: "unknown.third.party", title: "Unbekannt" }
  ]);
  assert.deepEqual(apps.map(app => app.id), ["com.webos.app.livetv", "netflix"]);
});

test("control catalog accepts only real HDMI app identifiers", () => {
  const inputs = allowedInputs([
    { id: "HDMI_1", appId: "com.webos.app.hdmi1", port: 1, label: "Apple TV", activate: true },
    { id: "AV_1", appId: "com.webos.app.externalinput.av1", port: 1 },
    { id: "HDMI_9", appId: "dangerous", port: 9 }
  ]);
  assert.deepEqual(inputs.map(input => input.id), ["HDMI_1"]);
  assert.equal(inputs[0].active, true);
});

test("remote control exposes only fixed safe button identifiers", () => {
  const buttons = allowedRemoteButtons();
  assert.ok(buttons.some(button => button.id === "home" && button.label === "Home"));
  assert.ok(buttons.some(button => button.id === "enter" && button.group === "dpad"));
  assert.equal(buttons.some(button => Object.hasOwn(button, "command")), false);
  assert.equal(safeRemoteButtonById.get("settings").command, "QMENU");
  assert.equal(safeRemoteButtonById.has("POWER"), false);
  assert.equal(safeRemoteButtonById.has("arbitrary-shell-command"), false);
});

test("wake-on-lan packet has the standard 102-byte shape", () => {
  const packet = wakePacket("02:00:00:00:00:50");
  assert.equal(packet.length, 102);
  assert.equal(packet.subarray(0, 6).toString("hex"), "ffffffffffff");
  assert.equal(packet.subarray(6, 12).toString("hex"), "020000000050");
  assert.throws(() => wakePacket("not-a-mac"));
});
