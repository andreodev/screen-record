import assert from 'node:assert/strict';
import { autoZooms, cameraAt, cameraKeys, cursorAt } from '../src/zoom.ts';

const events = [
  { t: 0, x: .1, y: .1, down: false },
  { t: 1, x: .1, y: .1, down: true },
  { t: 1.1, x: .1, y: .1, down: false },
  { t: 1.5, x: .15, y: .1, down: true },
  { t: 1.6, x: .15, y: .1, down: false },
  { t: 4, x: .95, y: .95, down: true },
];
const zooms = autoZooms(events, 6);
assert.equal(zooms.length, 2, 'Nearby clicks should share a zoom');
assert.deepEqual(autoZooms(events.map(e => ({ ...e, down: false })), 6), []);
assert.equal(cursorAt(0, []), null);
assert.deepEqual(cameraAt(0, []), { x: .5, y: .5, scale: 1 });
for (let t = 0; t <= 6; t += .005) {
  const c = cameraAt(t, zooms);
  assert.ok(c.scale >= 1 && c.scale <= 3);
  assert.ok(c.x - .5 / c.scale >= -1e-8 && c.x + .5 / c.scale <= 1 + 1e-8, 'Horizontal crop must stay on screen');
  assert.ok(c.y - .5 / c.scale >= -1e-8 && c.y + .5 / c.scale <= 1 + 1e-8, 'Vertical crop must stay on screen');
  const next = cameraAt(t + .001, zooms);
  assert.ok(Math.abs(next.scale - c.scale) < .02, 'Camera must be continuous');
}
for (const z of zooms) {
  assert.equal(cameraAt(z.start, [z]).scale, 1);
  assert.equal(cameraAt(z.end, [z]).scale, 1);
  assert.equal(cameraAt((z.start + z.end) / 2, [{ ...z, enabled: false }]).scale, 1);
}
const keys = cameraKeys(zooms, 6, true);
assert.equal(keys.length, 361);
assert.equal(keys[0].t, 0);
assert.equal(keys[keys.length - 1].t, 6);
for (let i = 1; i < keys.length; i++) assert.ok(keys[i].t > keys[i - 1].t);
assert.equal(cursorAt(1, events)?.down, true, 'Click timing should not lag the source event');
console.log('Zoom checks passed: grouping, bounds, continuity, disabled segments, seek and cursor timing.');

const { smoothCursor, cameraFromKeys } = await import('../src/zoom.ts');
const jitter = Array.from({ length: 120 }, (_, i) => ({ t: i / 120, x: .5 + (i % 2 ? .012 : -.012), y: .5, down: i === 60 }));
const smoothed = smoothCursor(jitter);
assert.equal(smoothed[60].x, jitter[60].x, 'Smoothing must preserve the exact click position');
assert.ok(Math.abs(smoothed[30].x - .5) < Math.abs(jitter[30].x - .5), 'Smoothing must reduce jitter');
const moving = Array.from({ length: 240 }, (_, i) => ({ t: i / 60, x: .2 + .6 * i / 239, y: .5, down: i === 30 }));
const follow = [{ id: 'follow', start: 0, end: 4, x: .2, y: .5, scale: 1.8, enabled: true, follow: true }];
const route = cameraKeys(follow, 4, true, moving);
assert.ok(cameraFromKeys(3, route).x > cameraFromKeys(1, route).x, 'Camera must follow large cursor movements');
for (const k of route) { assert.ok(k.x - .5 / k.scale >= -1e-8); assert.ok(k.x + .5 / k.scale <= 1 + 1e-8); }
assert.deepEqual(cameraFromKeys(2, route), cameraFromKeys(2, route), 'Seek should be independent of playback history');
console.log('Cursor checks passed: jitter reduction, click position, follow camera and crop bounds.');

const overlap = [
  { id: 'left', start: 0, end: 4, x: .2, y: .3, scale: 1.8, enabled: true },
  { id: 'right', start: 2, end: 6, x: .8, y: .7, scale: 1.9, enabled: true },
];
for (const boundary of [2, 4]) {
  const before = cameraAt(boundary - .0001, overlap), after = cameraAt(boundary + .0001, overlap);
  assert.ok(Math.abs(before.scale - after.scale) < .002, 'Overlapping zooms must not jump at their edges');
  assert.ok(Math.hypot(before.x - after.x, before.y - after.y) < .002);
}
const burst = Array.from({ length: 16 }, (_, i) => ({ t: 1 + i * .02, x: Math.floor(i / 2) % 2 ? .9 : .1, y: .5, down: i % 2 === 0 }));
for (const z of autoZooms(burst, 3)) assert.ok(z.end - z.start >= .1, 'Rapid clicks cannot create invalid zoom intervals');
console.log('Transition checks passed: overlapping segments and rapid click bursts.');

const handoff = cameraAt(2.325, overlap);
assert.ok(handoff.scale < 1.5, 'A distant handoff should open the framing');
for (let t = 0; t < 6; t += .01) {
  const c = cameraAt(t, overlap);
  assert.ok(c.x - .5 / c.scale >= -1e-8 && c.x + .5 / c.scale <= 1 + 1e-8);
  assert.ok(c.y - .5 / c.scale >= -1e-8 && c.y + .5 / c.scale <= 1 + 1e-8);
}
assert.equal(cursorAt(.25, [{t:0,x:0,y:0,down:false},{t:1,x:1,y:1,down:false}])?.x, .25, 'Smoothed cursor samples interpolate without micro-stops');

// Optional spring profiles remain finite, bounded and deterministic when seeking.
for (const smooth of [true, false]) {
  const zooms = [{ id: "spring", start: .2, end: 3, x: .85, y: .15, scale: 2.4, enabled: true }];
  const keys = cameraKeys(zooms, 4, smooth, [], true);
  assert.deepEqual(keys, cameraKeys(zooms, 4, smooth, [], true));
  for (const key of keys) {
    assert.ok(Number.isFinite(key.x) && Number.isFinite(key.y) && Number.isFinite(key.scale));
    assert.ok(key.scale >= 1 && key.scale <= 3);
    assert.ok(key.x >= .5 / key.scale && key.x <= 1 - .5 / key.scale);
    assert.ok(key.y >= .5 / key.scale && key.y <= 1 - .5 / key.scale);
  }
}
