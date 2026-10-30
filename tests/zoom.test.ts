import assert from 'node:assert/strict';
import { autoZooms, cameraAt, cameraFrame, cameraFromKeys, cameraKeys, cameraPoint, cameraViewportTransform, cursorAt, frameLayout, regenerateAutoZooms, upgradeAutoZooms, visibleSpans, zoomsForMode } from '../src/zoom.ts';

const verticalLayout = frameLayout(16 / 9, 9 / 16, false);
const paddedVerticalLayout = frameLayout(16 / 9, .514, false);
assert.equal(verticalLayout.width, 1, 'Contain keeps the full landscape width in the initial overview');
assert.ok(Math.abs(verticalLayout.height - 9 / 16 / (16 / 9)) < 1e-9, 'Contain base height is derived from source and canvas aspect ratios');

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
assert.ok(zooms.every(zoom => zoom.id.startsWith('auto-')), 'Generated focus blocks must remain distinguishable from manual edits');
const mixedZooms = [...zooms, { id:'hand-edit', start:2, end:3, x:.5, y:.5, scale:1.5, enabled:true }];
assert.equal(zoomsForMode(mixedZooms, 'auto').length, zooms.length);
assert.equal(zoomsForMode(mixedZooms, 'manual').length, 1);
assert.equal(zoomsForMode(mixedZooms, 'hybrid').length, mixedZooms.length);
assert.deepEqual(zoomsForMode([{ ...zooms[0]!, manualOverride: true }, mixedZooms[2]!], 'hybrid').map(zoom => zoom.id), [zooms[0].id, 'hand-edit'], 'Hybrid mode places manual edits above generated camera suggestions');
assert.equal(zoomsForMode([{ ...zooms[0]!, manualOverride: true }], 'manual').length, 1, 'Editing a generated zoom makes it available in manual mode');
const dwellFocus = autoZooms([{t:0,x:.1,y:.1,down:false},{t:.1,x:.3,y:.2,down:false},{t:.2,x:.3,y:.2,down:false},{t:.45,x:.3,y:.2,down:false},{t:.5,x:.3,y:.2,down:false}], 2)[0];
assert.ok(dwellFocus && dwellFocus.scale >= 1.65 && dwellFocus.scale < 2.2, 'A significant move followed by a dwell should create a visible, softer focus');
const timedDwell = autoZooms([{ t: 0, x: .1, y: .5, down: false }, { t: 2, x: .7, y: .5, down: false }, { t: 2.4, x: .7, y: .5, down: false }], 5)[0];
assert.ok(timedDwell.start >= 1.6, 'A dwell must use the time of the pause instead of accidentally inheriting the last movement timestamp');
assert.equal(autoZooms([{t:0,x:.5,y:.5,down:false},{t:.1,x:.51,y:.5,down:false},{t:.5,x:.51,y:.5,down:false}], 2).length, 0, 'Small pointer movements should not trigger a zoom');
assert.equal(autoZooms([{t:0,x:.2,y:.4,down:false},{t:.5,x:.2,y:.4,down:false,rightDown:true},{t:.55,x:.2,y:.4,down:false,rightDown:false}], 2).length, 1, 'Right-click interactions should be recognized');
const typingScene = autoZooms([
  {t:0,x:.7,y:.6,down:false},
  {t:.5,x:.7,y:.6,down:false,typing:true},
  {t:1.6,x:.7,y:.6,down:false,typing:true},
  {t:2.7,x:.7,y:.6,down:false,typing:true},
], 5);
assert.equal(typingScene.length, 1, 'A typing burst in one region should remain a single camera scene');
assert.equal(typingScene[0]?.x, .7, 'Typing focus should use the pointer location where typing started');
assert.ok((typingScene[0]?.end ?? 0) >= 4.8, 'Continued typing should hold the field long enough to read the result');
assert.equal(cursorAt(1.6, [{t:1.6,x:.7,y:.6,down:false,typing:true}])?.typing, true, 'Typing intent survives cursor sampling');
const fieldTyping = autoZooms([
  { t: 0, x: .35, y: .55, down: false },
  { t: .2, x: .35, y: .55, down: true },
  { t: .25, x: .35, y: .55, down: false },
  ...Array.from({ length: 25 }, (_, i) => ({ t: 1 + i * .12, x: .9, y: .1, down: false, typing: true })),
], 7);
assert.equal(fieldTyping.length, 1, 'Typing must hold one scene after clicking a field');
assert.equal(fieldTyping[0].x, .35, 'Moving the mouse must not steal focus from the field being typed into');
assert.equal(fieldTyping[0].follow, false, 'Typing scenes must hold the field rather than chase the pointer');
assert.ok(fieldTyping[0].end >= 5.4, 'Focus must last through the end of a typing section');
const typingPath = cameraKeys(fieldTyping, 7, true, [
  { t: 0, x: .35, y: .55, down: false }, { t: 1, x: .9, y: .1, down: false },
], true);
assert.ok(cameraFromKeys(3, typingPath).x < .45, 'Generated typing camera must remain on the input region');

const focusedClickEvents = [
  { t: 0, x: .5, y: .5, down: false },
  { t: 1, x: .5, y: .5, down: true },
  { t: 1.1, x: .5, y: .5, down: false },
  { t: 3, x: .5, y: .5, down: false },
];
const focusedClick = autoZooms(focusedClickEvents, 4)[0];
const quickVisit = autoZooms([
  ...focusedClickEvents.slice(0, 3),
  { t: 1.25, x: .85, y: .5, down: false },
  { t: 3, x: .85, y: .5, down: false },
], 4)[0];
const repeatedClicks = autoZooms([
  ...focusedClickEvents.slice(0, 3),
  { t: 1.8, x: .5, y: .5, down: true },
  { t: 1.9, x: .5, y: .5, down: false },
  { t: 2.6, x: .5, y: .5, down: true },
  { t: 2.7, x: .5, y: .5, down: false },
  { t: 4, x: .5, y: .5, down: false },
], 5)[0];
const spreadClicks = autoZooms([
  { t: 0, x: .35, y: .5, down: false },
  { t: 1, x: .35, y: .5, down: true },
  { t: 1.1, x: .35, y: .5, down: false },
  { t: 1.8, x: .5, y: .5, down: true },
  { t: 1.9, x: .5, y: .5, down: false },
  { t: 2.6, x: .58, y: .5, down: true },
  { t: 2.7, x: .58, y: .5, down: false },
  { t: 4, x: .58, y: .5, down: false },
], 5)[0];
const drag = autoZooms([
  { t: 0, x: .15, y: .2, down: false },
  { t: 1, x: .15, y: .2, down: true },
  { t: 2, x: .5, y: .5, down: true },
  { t: 2.8, x: .85, y: .8, down: false },
  { t: 4, x: .85, y: .8, down: false },
], 5)[0];
assert.ok(focusedClick.scale >= 2.4, 'A stable compact interaction should produce a clearly magnified shot');
assert.ok(quickVisit.scale >= 2 && quickVisit.scale < focusedClick.scale - .05, 'Navigation after a click should soften the shot without collapsing the interaction to an overview');
assert.ok(repeatedClicks.scale > focusedClick.scale + .15, 'Sustained attention in one place should justify a closer shot');
assert.ok(spreadClicks.scale < repeatedClicks.scale - .05, 'A group of controls needs more context than repeated clicks in one place');
assert.ok(spreadClicks.roiWidth! > repeatedClicks.roiWidth!, 'The inferred region must grow with interaction spread');
assert.ok(spreadClicks.scale >= 1.85, 'Grouped controls still need a visible zoom rather than almost unchanged framing');
assert.ok(drag.scale < focusedClick.scale - .5 && drag.roiWidth! > .9, 'A long drag should show its path instead of tightly cropping its start');
assert.ok(drag.end >= 3.4, 'A long drag must keep its camera scene active through release');
assert.ok(fieldTyping[0].roiWidth! > focusedClick.roiWidth!, 'Typing reserves more horizontal context for the input field');
assert.ok(dwellFocus.scale < focusedClick.scale, 'Passive pointer dwell should be gentler than an intentional click');
assert.ok(new Set([focusedClick, quickVisit, repeatedClicks, spreadClicks, drag, dwellFocus].map(zoom => zoom.scale)).size >= 5, 'Different interaction contexts must not collapse to two preset magnifications');
const steadyTrace = (hz: number) => Array.from({ length: 4 * hz + 1 }, (_, i) => ({
  t: i / hz, x: .5, y: .5, down: i / hz >= 1 && i / hz < 1.1,
}));
assert.deepEqual(autoZooms(steadyTrace(60), 4), autoZooms(steadyTrace(120), 4), 'Zoom decisions must depend on time and geometry rather than cursor sample count');
assert.deepEqual(autoZooms(focusedClickEvents, 4), autoZooms(focusedClickEvents, 4), 'Contextual framing must be deterministic');
const adaptiveKeys = cameraKeys([focusedClick], 4, true, focusedClickEvents);
assert.ok(cameraFromKeys(2, adaptiveKeys).scale > 2.25, 'Preview and export must preserve the stronger computed magnification');
assert.ok(cameraFromKeys(3.5, adaptiveKeys).scale > cameraFromKeys(2, adaptiveKeys).scale + .08, 'A held automatic shot must progressively move closer instead of staying static');
assert.ok(focusedClick.end - focusedClick.start >= 3.5, 'An isolated click must create a readable shot rather than a brief pulse');
const spacedClicks = autoZooms([
  { t: 0, x: .5, y: .5, down: false },
  ...[1, 3.1, 5.2].flatMap(t => [{ t, x: .5, y: .5, down: true }, { t: t + .1, x: .5, y: .5, down: false }]),
  { t: 10, x: .5, y: .5, down: false },
], 10);
assert.equal(spacedClicks.length, 1, 'Related actions separated by reading pauses must share one sustained shot');
assert.ok(spacedClicks[0].end - spacedClicks[0].start > 8, 'Related focus must last across the complete activity');
const oldSuggestion = { id: 'auto-0', start: .5, end: 3, x: .5, y: .5, scale: 1.08, enabled: true };
const handEdit = { ...oldSuggestion, id: 'manual-1', start: 2, end: 3, scale: 2.2 };
const upgraded = upgradeAutoZooms([oldSuggestion, handEdit], focusedClickEvents, 4);
assert.ok(upgraded.some(zoom => zoom.id.startsWith('auto-v3-') && zoom.scale > 2.4 && zoom.end - zoom.start > 3.5), 'Existing weak suggestions must receive the stronger, longer framing');
assert.strictEqual(upgraded.find(zoom => zoom.id === handEdit.id), handEdit, 'Upgrading automatic shots must preserve manual edits');
assert.strictEqual(upgradeAutoZooms(upgraded, focusedClickEvents, 4), upgraded, 'Current suggestions must not regenerate repeatedly or undo user edits');
const cleared: typeof upgraded = [];
assert.strictEqual(upgradeAutoZooms(cleared, focusedClickEvents, 4), cleared, 'An intentionally cleared timeline must stay empty');
const disabled = { ...oldSuggestion, id: 'auto-disabled', enabled: false };
const withDisabled = upgradeAutoZooms([oldSuggestion, disabled], focusedClickEvents, 4);
assert.strictEqual(withDisabled.find(zoom => zoom.id === disabled.id), disabled, 'Disabled automatic shots must survive an upgrade');
assert.ok(withDisabled.every(zoom => !zoom.enabled || zoom.end <= disabled.start || zoom.start >= disabled.end), 'An upgrade must not reintroduce focus over a disabled interval');
const editedAutomatic = { ...focusedClick, manualOverride: true, scale: 2.1 };
const recalculated = regenerateAutoZooms([editedAutomatic, handEdit], focusedClickEvents, 4);
assert.strictEqual(recalculated.find(zoom => zoom.id === editedAutomatic.id), editedAutomatic, 'Recalculating automatic shots must retain hand-adjusted suggestions');
assert.equal(new Set(recalculated.map(zoom => zoom.id)).size, recalculated.length, 'Recalculation must not create duplicate IDs after editing an automatic shot');
const changingStrength = cameraKeys([
  { id: 'auto-detail', start: .2, end: 1.8, x: .5, y: .5, scale: 2.4, enabled: true },
  { id: 'auto-context', start: 2.4, end: 3.8, x: .5, y: .5, scale: 1.2, enabled: true },
], 4, true);
assert.ok(cameraFromKeys(1.5, changingStrength).scale > 2.3 && cameraFromKeys(3.5, changingStrength).scale < 1.3, 'Nearby scenes must retain their own strengths when context changes');

const chainedScenes = cameraKeys([
  { id: 'auto-chain-0', start: .2, end: 1.6, x: .6, y: .5, scale: 1.4, enabled: true },
  { id: 'auto-chain-1', start: 2, end: 3.2, x: .6, y: .5, scale: 1.4, enabled: true },
  { id: 'auto-chain-2', start: 3.7, end: 5, x: .6, y: .5, scale: 1.4, enabled: true },
], 6, true);
assert.ok(cameraFromKeys(4.3, chainedScenes).scale > 1.3, 'Merging three related scenes must preserve the last scene');
assert.equal(autoZooms([{t:0,x:.1,y:.1,down:false},{t:.2,x:.1,y:.1,down:true},{t:.25,x:.1,y:.1,down:false},{t:.7,x:.9,y:.9,down:true},{t:.75,x:.9,y:.9,down:false}], 3).length, 1, 'A distant second interaction inside the camera cooldown should not trigger a jolt');
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
const portraitSpan = 9 / 16 / (16 / 9);
assert.deepEqual(visibleSpans(16/9, 9/16, true), {x:portraitSpan,y:1}, 'Landscape recordings should expose only the useful 9:16 source window');
assert.deepEqual(visibleSpans(9/16, 16/9, true), {x:1,y:portraitSpan}, 'Portrait sources framed in landscape should crop vertically');
assert.deepEqual(visibleSpans(16/9, 9/16, false), {x:1,y:1}, 'Letterboxed output must preserve the complete source');
const mobileOverview = cameraFrame({ x: .5, y: .5, scale: 1 }, 960, 540, 1080, 1920);
assert.deepEqual(mobileOverview, { left: 60, top: 690, width: 960, height: 540 }, 'Overview positions the complete recording frame inside the mobile canvas');
const sampledClick = cursorAt(1, events)!;
assert.equal(sampledClick.down, true);
assert.deepEqual(cameraPoint({ x: .5, y: .5, scale: 1 }, sampledClick, 960, 540, 1080, 1920), { x: 156, y: 744 }, 'A recorded click position maps to the same location inside the final canvas');
const mobileFocus = cameraFrame({ x: .25, y: .6, scale: 1.5 }, 960, 540, 1080, 1920);
assert.equal(mobileFocus.left + .25 * mobileFocus.width, 540, 'Camera maps the focused source point to the output canvas center');
assert.equal(mobileFocus.top + .6 * mobileFocus.height, 960, 'Camera maps the focused source point to the output canvas center vertically');
const previewTransform = cameraViewportTransform({ x: .25, y: .6, scale: 1.5 }, 960, 540, 1080, 1920);
assert.equal((1080 - 960) / 2 + previewTransform.x, mobileFocus.left, 'Preview translation moves the centered video layer to the camera frame');
assert.equal((1920 - 540) / 2 + previewTransform.y, mobileFocus.top, 'Preview and export place the recording layer at the same camera position');
assert.equal((1080 - 960) / 2 + previewTransform.x + .25 * 960 * previewTransform.scale, 540, 'The previewed cursor point stays attached to the video during portrait zoom');
assert.equal((1920 - 540) / 2 + previewTransform.y + .6 * 540 * previewTransform.scale, 960, 'The previewed cursor point stays attached vertically during portrait zoom');
assert.deepEqual(cameraPoint({ x: .25, y: .6, scale: 1.5 }, { x: .25, y: .6 }, 960, 540, 1080, 1920), { x: 540, y: 960 }, 'Cursor anchor and camera focus map to the same output point');
assert.ok(mobileFocus.width > mobileOverview.width && mobileFocus.left > mobileOverview.left, 'Global camera enlarges and repositions the recording layer beyond its overview bounds');
const desktopFocus = cameraFrame({ x: .7, y: .3, scale: 1.4 }, 1660, 933.75, 1920, 1080);
assert.equal(desktopFocus.left + .7 * desktopFocus.width, 960, 'Desktop camera uses the same canvas-relative focus coordinates');
assert.equal(desktopFocus.top + .3 * desktopFocus.height, 540, 'Desktop camera uses the same canvas-relative focus coordinates vertically');
const gentleZoom = [{ id: 'gentle', start: .4, end: 1.6, x: .7, y: .4, scale: 1.15, enabled: true }];
const steadyKeys = cameraKeys(gentleZoom, 2, true);
const shakenKeys = cameraKeys(gentleZoom, 2, true, [], false, 1, 1, false, true);
assert.deepEqual(shakenKeys, steadyKeys, 'Legacy vertical shake is disabled; cinematic impacts are a separate post-process');
const portraitKeys = cameraKeys([{ id: 'portrait', start: .2, end: 1.8, x: .99, y: .02, scale: 2, enabled: true }], 2, true, [], true, portraitSpan, 1);
for (const key of portraitKeys) {
  assert.ok(key.x >= portraitSpan / (2 * key.scale) - 1e-8 && key.x <= 1 - portraitSpan / (2 * key.scale) + 1e-8, 'Mobile camera focus must stay inside the visible 9:16 crop');
  assert.ok(key.y >= 1 / (2 * key.scale) - 1e-8 && key.y <= 1 - 1 / (2 * key.scale) + 1e-8, 'Mobile camera focus must preserve vertical source bounds');
}
const mobileEvents = Array.from({ length: 240 }, (_, i) => ({ t: i / 60, x: .2 + .6 * i / 239, y: .5, down: false }));
const mobileFollow = cameraKeys([], 4, true, mobileEvents, false, portraitSpan, 1, true);
assert.ok(cameraFromKeys(3.8, mobileFollow).x > cameraFromKeys(.1, mobileFollow).x + .1, 'Mobile crop should pan smoothly to follow the cursor even between zooms');
for (const key of mobileFollow) assert.ok(key.x >= portraitSpan / 2 - 1e-8 && key.x <= 1 - portraitSpan / 2 + 1e-8, 'Cursor-follow crop must remain within the recording bounds');
const analyzedZooms = [
  { id: 'auto-7', start: 10.491, end: 12.741, x: .501, y: .904, scale: 1.65, enabled: true, follow: true },
  { id: 'auto-8', start: 13.340, end: 15.590, x: .405, y: .549, scale: 1.4, enabled: true, follow: true },
  { id: 'auto-9', start: 17.856, end: 19.635, x: .463, y: .663, scale: 1.4, enabled: true, follow: true },
];
const analyzedMobile = cameraKeys(analyzedZooms, 19.635, true, [], false, 1, 1, false, false, 16 / 9, .514);
const analyzedDesktop = cameraKeys(analyzedZooms, 19.635, true, [], false, 1, 1, false, false, 16 / 9, 16 / 9);
assert.ok(cameraFromKeys(12.906, analyzedMobile).scale >= 1 / paddedVerticalLayout.height - .02, 'Mobile zoom reaches the exact cover scale needed to use the padded canvas height');
assert.ok(cameraFromKeys(11.5, analyzedDesktop).scale > 1.6, 'Desktop framing honors the scene strength instead of imposing a fixed cap');
assert.ok(Math.abs(cameraFromKeys(12.906, analyzedMobile).scale - cameraFromKeys(12.74, analyzedMobile).scale) < .12, 'A short gap between different scenes must pan continuously without returning to overview');
assert.ok(cameraFromKeys(17, analyzedMobile).scale > 2.2, 'A short pause before the next interaction should retain the current readable scene');
const heldVertical = cameraKeys([
  { id: 'auto-first', start: .2, end: 1.8, x: .72, y: .34, scale: 1.65, enabled: true },
  { id: 'auto-later', start: 5.2, end: 6.8, x: .31, y: .72, scale: 1.65, enabled: true },
], 7, true, [], false, 1, 1, false, false, 16 / 9, 9 / 16);
assert.ok(cameraFromKeys(3.5, heldVertical).scale > 2.7, 'Vertical automatic framing must hold a readable camera through long gaps instead of returning to a small contain view');
assert.ok(Math.hypot(cameraFromKeys(3.5, heldVertical).x - cameraFromKeys(2, heldVertical).x, cameraFromKeys(3.5, heldVertical).y - cameraFromKeys(2, heldVertical).y) < .04, 'Vertical framing remains stable between nearby interactions');
const mobileHeadroom = cameraKeys([{ id: 'auto-top', start: .2, end: 2.2, x: .4, y: .03, scale: 1.65, enabled: true }], 2.5, true, [], false, 1, 1, false, false, 16 / 9, 9 / 16);
assert.ok(cameraFromKeys(1.2, mobileHeadroom).scale > 3 && cameraFromKeys(1.2, mobileHeadroom).y === .5, 'Mobile focus approaches geometry-derived cover scale and clamps an edge ROI to avoid blank bands');
for (let t = 12.7; t < 14; t += 1 / 60) {
  const before = cameraFromKeys(t, analyzedMobile), after = cameraFromKeys(t + 1 / 60, analyzedMobile);
  assert.ok(Math.abs(after.scale - before.scale) < .035 && Math.hypot(after.x - before.x, after.y - before.y) < .035, 'Scene handoffs must stay smooth at video frame cadence');
}
const sameRegion = cameraKeys([
  { id: 'auto-0', start: .2, end: 1.8, x: .6, y: .4, scale: 1.65, enabled: true },
  { id: 'auto-1', start: 2.4, end: 3.8, x: .63, y: .42, scale: 1.4, enabled: true },
], 5, true, [], false, 1, 1, false, false, 16 / 9, .514);
assert.ok(cameraFromKeys(2.1, sameRegion).scale > 2.2, 'Nearby interactions in one region should keep the same camera scene active through short gaps');
console.log('Zoom checks passed: grouping, bounds, continuity, disabled segments, seek and cursor timing.');

const { smoothCursor } = await import('../src/zoom.ts');
const jitter = Array.from({ length: 120 }, (_, i) => ({ t: i / 120, x: .5 + (i % 2 ? .012 : -.012), y: .5, down: i === 60 }));
const smoothed = smoothCursor(jitter);
assert.equal(smoothed[60].x, jitter[60].x, 'Smoothing must preserve the exact click position');
assert.ok(Math.abs(smoothed[30].x - .5) < Math.abs(jitter[30].x - .5), 'Smoothing must reduce jitter');
const moving = Array.from({ length: 240 }, (_, i) => ({ t: i / 60, x: .2 + .6 * i / 239, y: .5, down: i === 30 }));
const follow = [{ id: 'follow', start: 0, end: 4, x: .2, y: .5, scale: 1.8, enabled: true, follow: true }];
const route = cameraKeys(follow, 4, true, moving);
assert.ok(cameraFromKeys(3, route).x > cameraFromKeys(1, route).x, 'Camera must follow large cursor movements');
assert.ok(cameraFromKeys(2.5, route).x > cameraFromKeys(2, route).x, 'Follow camera should keep moving with a fast cursor path');
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
