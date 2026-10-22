import assert from 'node:assert/strict';
import { cursorDimensions, cursorImage, cursorThemes, themeCursor } from '../src/cursor.ts';
import { cursorAt, defaults, smoothCursor, type CursorEvent } from '../src/zoom.ts';

const events: CursorEvent[] = [
  {t:0,x:.5,y:.5,down:false,kind:'pointer'},
  {t:1,x:.5,y:.5,down:false,kind:'pointinghand'},
  {t:2,x:.5,y:.5,down:false,kind:'ibeam'},
];
assert.equal(cursorAt(.999, events)?.kind, 'pointer');
assert.equal(cursorAt(1, events)?.kind, 'pointinghand');
assert.equal(cursorAt(2.5, events)?.kind, 'ibeam');
assert.deepEqual(smoothCursor(events).map(event=>event.kind), events.map(event=>event.kind));
const hand = cursorImage({...defaults,cursorTheme:'macos'}, events[1]);
assert.equal(hand.label, 'pointinghand-1');
assert.equal(themeCursor('custom-1','pointinghand').group, 'custom-1');
assert.equal(themeCursor('custom-1','ibeam').group, 'macos');
for (const theme of cursorThemes) {
  const image = themeCursor(theme);
  const small = cursorDimensions(image, 16, 1000), large = cursorDimensions(image, 32, 1000);
  assert.equal(large.height, small.height * 2);
  assert.ok(Math.abs(small.height * image.visibleHeight / image.height - 16) < 1e-9);
  assert.equal(cursorDimensions(image,0,1000).height, 0);
  assert.ok(Math.abs(cursorDimensions(image,16,1000,3).height - small.height * 3) < 1e-9);
  assert.ok(image.width >= 512 || image.height >= 512, `Low-resolution cursor: ${image.id}`);
}
assert.equal(cursorImage({...defaults,cursorTheme:undefined,cursorAsset:hand.id},events[0]).id,hand.id);
console.log('Cursor checks passed: themes, context transitions, fallback, legacy assets and visible size.');
