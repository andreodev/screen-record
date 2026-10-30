import assert from "node:assert/strict";
import { validCaptureArea } from "../src/capture-options.ts";

const source = { id: 9, kind: "display" as const, label: "Monitor", width: 1920, height: 1080 };
assert(validCaptureArea({ x: 0, y: 0, width: 1920, height: 1080 }, source));
assert(validCaptureArea({ x: 1888, y: 1048, width: 32, height: 32 }, source));
for (const area of [
  { x: -1, y: 0, width: 640, height: 480 },
  { x: 0, y: 0, width: 31, height: 480 },
  { x: 0, y: 0, width: 640, height: Number.NaN },
  { x: 1500, y: 0, width: 640, height: 480 },
  { x: 0, y: 1000, width: 640, height: 480 },
]) assert.equal(validCaptureArea(area, source), false);
console.log("Capture areas: monitor bounds, minimum dimensions and non-finite coordinates passed.");
