import assert from 'node:assert/strict';
import { cameraFromKeys, cameraKeys, cursorMotionFor, defaults, smoothCursor, type CursorEvent } from '../src/zoom.ts';

for (const smooth of [true, false]) {
  assert.equal(cursorMotionFor({ ...defaults, smooth }), 'medium');
  assert.equal(cursorMotionFor({ ...defaults, smooth, cursorSmooth: false }), 'original');
  for (const cursorMotion of ['original', 'smooth', 'medium', 'rapid'] as const) {
    assert.equal(cursorMotionFor({ ...defaults, smooth, cursorMotion }), cursorMotion);
  }
}

// At 480 Hz, the old 16-sample cap made Suave behave like Rápido.
const events: CursorEvent[] = Array.from({ length: 481 }, (_, i) => ({
  t: i / 480, x: i === 240 ? .8 : .5, y: .4, down: i === 384, kind: 'pointer',
}));
const original = structuredClone(events);
const profiles = [.1, .065, .035].map(window => smoothCursor(events, window));
assert.ok(profiles[0][240].x < profiles[1][240].x);
assert.ok(profiles[1][240].x < profiles[2][240].x);
for (const profile of profiles) {
  assert.deepEqual(profile[384], events[384], 'Keep the exact click location and timestamp');
  assert.deepEqual(profile.map(({ t, down, kind }) => ({ t, down, kind })), events.map(({ t, down, kind }) => ({ t, down, kind })));
}
assert.deepEqual(events, original, 'Changing profiles cannot modify the recording');
assert.deepEqual(smoothCursor([]), []);
assert.deepEqual(smoothCursor(events.slice(0, 1)), events.slice(0, 1));

const zooms = [{ id: 'test', start: .2, end: 2.5, x: .8, y: .2, scale: 2, enabled: true }];
const focused = cameraKeys(zooms, 4, false);
const fluid = cameraKeys(zooms, 4, true);
assert.ok(cameraFromKeys(.5, focused).scale > cameraFromKeys(.5, fluid).scale, 'Focado must stabilize sooner');
for (const smooth of [true, false]) {
  const base = cameraKeys(zooms, 4, smooth);
  const inertia = cameraKeys(zooms, 4, smooth, [], true);
  assert.notDeepEqual(inertia, base, 'Inertia must change the camera path');
  assert.deepEqual(inertia, cameraKeys(zooms, 4, smooth, [], true), 'Seeking must be deterministic');
  assert.ok(Math.abs(inertia[inertia.length - 1].scale - 1) < .01, 'Camera must settle after zoom out');
}
console.log('Animation checks passed: independent controls, distinct profiles, high-rate events, clicks, screen styles and inertia.');

const {motionFrames} = await import('../src/motion.ts');
const instant = [{...zooms[0], start: .213, end: 2.517, instant: true}];
for (const spring of [false, true]) {
  const keys = cameraKeys(instant, 4, true, [], spring);
  assert.equal(cameraFromKeys(.21299, keys).scale, 1, 'Instant zoom cannot interpolate before its boundary');
  assert.equal(cameraFromKeys(.213, keys).scale, 2);
  assert.equal(cameraFromKeys(2.51699, keys).scale, 2);
  assert.equal(cameraFromKeys(2.517, keys).scale, 1);
  assert.equal(motionFrames(.213, keys, events, {start: 0, end: 4}, {cursor: 1, zoom: 1, pan: 1}, [.213, 2.517]).length, 1, 'Blur cannot cross instant transitions');
}
const keys = [{t: 0, x: .5, y: .5, scale: 1}, {t: 1, x: .7, y: .6, scale: 2}];
const moving = [{t: 0, x: .2, y: .3, down: false}, {t: 1, x: .8, y: .7, down: false}];
const clip = {start: 0, end: 1};
assert.equal(motionFrames(.5, keys, moving, clip).length, 1);
assert.equal(motionFrames(.5, keys, moving, clip, {cursor: 0, zoom: 0, pan: 0}).length, 1);
for (const effect of ['cursor', 'zoom', 'pan'] as const) {
  const frames = motionFrames(.5, keys, moving, clip, {cursor: 0, zoom: 0, pan: 0, [effect]: 1});
  assert.equal(frames.length, 5);
  const first = frames[0], last = frames[4];
  assert.equal(first.cursor!.x === last.cursor!.x, effect !== 'cursor');
  assert.equal(first.camera.scale === last.camera.scale, effect !== 'zoom');
  assert.equal(first.camera.x === last.camera.x, effect !== 'pan');
}
assert.ok(motionFrames(.5, keys, moving, {...clip, hideCursor: true}, {cursor: 1, zoom: 0, pan: 0}).every(frame => frame.cursor === null));
assert.equal(motionFrames(.5, keys, moving, {start: .5, end: 1}, {cursor: 1, zoom: 1, pan: 1}).length, 1, 'Exposure cannot use frames from a deleted interval');
const slow = motionFrames(.5, keys, moving, {...clip, speed: .5}, {cursor: 1, zoom: 0, pan: 0});
const fast = motionFrames(.5, keys, moving, {...clip, speed: 2}, {cursor: 1, zoom: 0, pan: 0});
assert.ok(fast[4].cursor!.x < slow[4].cursor!.x, 'Shutter must follow clip speed');
assert.deepEqual(fast, motionFrames(.5, keys, moving, {...clip, speed: 2}, {cursor: 1, zoom: 0, pan: 0}));
console.log('New effects passed: instant zoom with inertia, independent blur, cut boundaries, variable speed and deterministic seek.');
