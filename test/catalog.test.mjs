import test from "node:test";
import assert from "node:assert/strict";
import { displayValue, encodedValue, settingById, validateValue } from "../src/settings-catalog.mjs";
import { profilesCatalog } from "../src/profiles.mjs";

test("allowlist accepts only enumerated values with matching types", () => {
  const mobile = settingById.get("network.allowMobileDeviceAccess");
  assert.equal(validateValue(mobile, true), true);
  assert.equal(validateValue(mobile, "true"), false);
  assert.equal(validateValue(mobile, false), true);
});

test("personal recommendation is decoded and encoded safely", () => {
  const setting = settingById.get("general.personalRecommend");
  assert.equal(displayValue(setting, { changedByUser: false, value: "on" }), "on");
  assert.deepEqual(encodedValue(setting, "off"), { changedByUser: true, value: "off" });
});

test("profiles contain only valid allowlisted targets and leave network control untouched", () => {
  for (const profile of profilesCatalog) {
    assert.ok(profile.targets.length > 0);
    for (const target of profile.targets) {
      const setting = settingById.get(target.id);
      assert.ok(setting, target.id);
      assert.equal(validateValue(setting, target.value), true, target.id);
      assert.notEqual(setting.group, "Netzwerk", target.id);
    }
  }
});

test("energy profile preserves remote access and normal viewing", () => {
  const profile = profilesCatalog.find(candidate => candidate.id === "energy-safe");
  assert.ok(profile);
  assert.deepEqual(profile.targets, [
    { id: "time.autoOff15Min", value: "on" },
    { id: "time.noSignalAutoOff", value: "on" },
    { id: "option.quickStartMode", value: "off" }
  ]);
  assert.equal(profile.targets.some(target => target.id === "time.noOperationAutoOff"), false);
  assert.equal(profile.targets.some(target => target.id.startsWith("network.")), false);
});
