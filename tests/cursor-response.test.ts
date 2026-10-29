import assert from 'node:assert/strict';
import { responsiveCursor, cursorResponseFor } from '../src/cinematic.ts';
import { cameraKeys, cameraFromKeys, cursorAt, defaults, smoothCursor, type CursorEvent } from '../src/zoom.ts';
import { motionFrames } from '../src/motion.ts';

const samples = (position: (t: number) => { x: number; y: number }): CursorEvent[] =>
  Array.from({ length: 361 }, (_, i) => ({ t: i / 120, ...position(i / 120), down: false }));
const horizontal = samples(t => ({ x: .2 + .25 * Math.min(t, 2), y: .5 }));
const vertical = samples(t => ({ x: .5, y: .2 + .25 * Math.min(t, 2) }));
const diagonal = samples(t => ({ x: .2 + .3 * Math.min(t, 2), y: .2 + .3 * Math.min(t, 2) }));
const reversed = samples(t => ({ x: t < 1 ? .2 + .5 * t : t < 2 ? .7 - .5 * (t - 1) : .2, y: .5 }));
const idle = samples(() => ({ x: .5, y: .5 }));
idle.forEach(e => { e.typing = true; });
const response = { style: 'dynamic', intensity: 1, directionImpact: true } as const;
const keys = cameraKeys([], 3, true);
assert.equal(cursorResponseFor({ ...defaults, cursorResponse: undefined }).style, 'off', 'Old projects must not silently acquire cursor shake');
assert.deepEqual(responsiveCursor(horizontal, keys, { ...response, style: 'off' }), horizontal);
assert.deepEqual(responsiveCursor(horizontal, keys, { ...response, intensity: 0 }), horizontal);
assert.deepEqual(responsiveCursor(idle, keys, response), idle, 'Stationary typing must stay still');
for (const source of [horizontal, vertical, diagonal, reversed]) {
  const rendered = responsiveCursor(source, keys, response);
  assert.deepEqual(rendered, responsiveCursor(source, keys, response), 'Seeking cannot alter the result');
  assert.ok(rendered.some((p, i) => Math.hypot(p.x - source[i].x, p.y - source[i].y) > .0002), 'Moving cursor needs a visible response');
  for (let i = 0; i < source.length; i++) {
    const a = source[i], b = rendered[i];
    assert.ok(Math.hypot(a.x - b.x, a.y - b.y) <= .0035 + 1e-10, 'Diagonal motion cannot amplify the displacement budget');
    if (a.t >= 2.12) assert.deepEqual(b, a, 'Shake must end within 120 ms of stopping');
  }
}
const axisEnergy = (source: CursorEvent[]) => responsiveCursor(source, keys, response).reduce((v, e, i) => ({ x: v.x + (e.x - source[i].x) ** 2, y: v.y + (e.y - source[i].y) ** 2 }), { x: 0, y: 0 });
const hx = axisEnergy(horizontal), vy = axisEnergy(vertical);
assert.ok(hx.x > hx.y * 4 && vy.y > vy.x * 4, 'Shake must favor the movement direction');
assert.notDeepEqual(responsiveCursor(reversed, keys, response), responsiveCursor(reversed, keys, { ...response, directionImpact: false }), 'Direction switch needs a separate, optional accent');
const edge = samples(t => ({ x: .999, y: .2 + .25 * Math.min(t, 2) }));
assert.ok(axisEnergy(edge).y < vy.y * .05, 'Edges must attenuate the response');

for (const button of ['down', 'rightDown', 'middleDown'] as const) {
  const source = diagonal.map(e => ({ ...e, [button]: e.t >= 1 && e.t < 1.1 }));
  const softened = smoothCursor(source), rendered = responsiveCursor(softened, keys, response);
  const click = rendered[120];
  assert.equal(click.x, source[120].x); assert.equal(click.y, source[120].y);
  assert.deepEqual(rendered[132], softened[132], 'Release anchor must stay exact');
  const frames = motionFrames(1, keys, rendered, { start: 0, end: 3 }, { cursor: 1, zoom: 1, pan: 1 });
  assert.ok(frames.every(f => f.cursor?.x === click.x && f.cursor?.y === click.y), 'Blur cannot move a pressed cursor');
}

const focus = [{ id: 'auto-follow', start: 0, end: 3, x: .2, y: .5, scale: 1.65, follow: true, enabled: true }];
const off = cameraKeys(focus, 3, true, horizontal, true, 1, 1, false, false, 16 / 9, 16 / 9, .95, { cursorFollow: 'off' });
const balanced = cameraKeys(focus, 3, true, horizontal, true, 1, 1, false, false, 16 / 9, 16 / 9, .95, { cursorFollow: 'balanced', zoomAnticipation: 0 });
const close = cameraKeys(focus, 3, true, horizontal, true, 1, 1, false, false, 16 / 9, 16 / 9, .95, { cursorFollow: 'close', zoomAnticipation: .35 });
assert.ok(cameraFromKeys(2, close).x > cameraFromKeys(2, balanced).x, 'Close follow and anticipation should reduce camera lag');
assert.ok(cameraFromKeys(2, balanced).x > cameraFromKeys(2, off).x, 'Disabling follow must hold the selected focus');
for (const aspect of [16 / 9, 9 / 16, 1]) {
  const route = cameraKeys(focus, 3, true, diagonal, true, 1, 1, false, false, 16 / 9, aspect, .95, { cursorFollow: 'close', zoomAnticipation: .35 });
  const width = Math.min(1, (16 / 9) / aspect), height = Math.min(1, aspect / (16 / 9));
  const rendered = responsiveCursor(diagonal, route, response, width, height);
  for (const p of rendered) {
    const cam = cameraFromKeys(p.t, route), original = cursorAt(p.t, diagonal)!;
    assert.ok(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1);
    const x = .5 + (p.x - cam.x) * width * cam.scale, y = .5 + (p.y - cam.y) * height * cam.scale;
    assert.ok(x >= .095 && x <= .905 && y >= .095 && y <= .905, 'Automatic follow must keep the cursor in the safe crop across aspect ratios');
    assert.ok(Math.hypot((p.x - original.x) * width * cam.scale, (p.y - original.y) * height * cam.scale) <= .0035 + 1e-10, 'Zoom must not enlarge shake beyond its canvas budget');
  }
}
console.log('Cursor response passed: directional energy, amplitude, idle, edges, all click buttons, blur, follow modes, seek and aspect ratios.');

assert.deepEqual(responsiveCursor(horizontal, keys, cursorResponseFor(defaults)), horizontal, 'Default cursor follows its path without added oscillation');
