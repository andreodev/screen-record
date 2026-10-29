import assert from 'node:assert/strict';
import { cropPoint, sourcePoint, dragCrop, fullCrop, normalizedCrop } from '../src/crop.ts';
import { cameraKeys, cameraFromKeys, frameLayout } from '../src/zoom.ts';

const crop = { x: .25, y: .1, width: .5, height: .6 };
const point = { x: .5, y: .4, t: 1, down: true };
assert.deepEqual(sourcePoint(cropPoint(point, crop), crop), point);
assert.deepEqual(cropPoint({ x: .25, y: .1 }, crop), { x: 0, y: 0 });
assert.deepEqual(sourcePoint({ x: 1, y: 1 }, crop), { x: .75, y: .7 });
assert.deepEqual(normalizedCrop(), fullCrop);
assert.deepEqual(normalizedCrop({ x: 2, y: -1, width: .5, height: 4 }), { x: .5, y: 0, width: .5, height: 1 });
assert.deepEqual(normalizedCrop({ ...crop, x: NaN }), fullCrop);
assert.deepEqual(dragCrop(crop, 'move', 10, -10), { ...crop, x: .5, y: 0 });
for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
  for (const delta of [-2, -.1, 0, .1, 2]) {
    const result = dragCrop(crop, handle, delta, -delta);
    assert.ok(result.x >= 0 && result.y >= 0);
    assert.ok(result.x + result.width <= 1 + 1e-12 && result.y + result.height <= 1 + 1e-12);
    assert.ok(result.width >= .02 - 1e-12 && result.height >= .02 - 1e-12);
  }
}
// Camera keys remain in original source coordinates, including an off-center crop.
const aspect = 16 / 9 * crop.width / crop.height;
const keys = cameraKeys([], 2, true, [], false, 1, 1, false, false, aspect, aspect).map(key => sourcePoint(key, crop));
const camera = cameraFromKeys(1, keys);
assert.ok(Math.abs(camera.x - .5) < 1e-12 && Math.abs(camera.y - .4) < 1e-12);
assert.equal(camera.scale, 1);
assert.deepEqual(frameLayout(aspect, aspect, false), { width: 1, height: 1 });
console.log('Crop: selection bounds, eight resize handles, coordinate round trips and camera alignment passed.');
