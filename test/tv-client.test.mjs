import test from "node:test";
import assert from "node:assert/strict";
import { parseLunaResponse } from "../src/tv-client.mjs";

test("parses a formatted luna response surrounded by SSH text", () => {
  const output = 'warning\n{\n  "settings": {"homePromotion": "on"},\n  "returnValue": true\n}\nConnection closed';
  assert.deepEqual(parseLunaResponse(output), { settings: { homePromotion: "on" }, returnValue: true });
});

test("ignores an earlier JSON object and returns the final response", () => {
  assert.deepEqual(parseLunaResponse('{"debug":true}\n{"returnValue":true,"settings":{}}'), { returnValue: true, settings: {} });
});
