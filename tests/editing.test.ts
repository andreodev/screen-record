import assert from 'node:assert/strict';
import { applySuggestions, silenceSuggestions, typingSuggestions } from '../src/pacing.ts';
import { parseSrt } from '../src/subtitles.ts';
import { wrapText } from '../src/annotations.ts';
import { cursorActivity, cursorIdleOpacity, lastTimeAt } from '../src/cursor-activity.ts';
import { editedDuration } from '../src/timeline.ts';

const silence = silenceSuggestions({ step: .1, duration: 2.3, levels: [...Array(10).fill(0), .2, .3, .2, ...Array(10).fill(0)] });
assert.equal(silence.length, 2);
assert.deepEqual(silence[0], { kind: 'silence', start: .15, end: .85 });
assert.ok(Math.abs(silence[1].end - 2.15) < 1e-9);
assert.deepEqual(silenceSuggestions({ step: .1, duration: .7, levels: Array(7).fill(0) }), []);
const edited = applySuggestions([{ start: 0, end: 2, speed: .5, hideCursor: true }, { start: 3, end: 5, cursorOriginal: true }], [{ kind: 'silence', start: 1, end: 4 }]);
assert.deepEqual(edited, [{ start: 0, end: 1, speed: .5, hideCursor: true }, { start: 4, end: 5, cursorOriginal: true }]);
assert.equal(editedDuration(edited), 3);
assert.deepEqual(applySuggestions([{ start: 0, end: 5, speed: 4 }], [{ start: 1, end: 3, kind: 'typing' }]).map(clip => clip.speed), [4, 4, 4]);
assert.deepEqual(typingSuggestions([0, .6, 1.2, 4].map(t => ({ t, typing: true, x: .5, y: .5, down: false }))), [{ kind: 'typing', start: 0, end: 1.2 }]);
const captions = parseSrt('\uFEFF1\r\n00:00:00,200 --> 00:00:01,500\r\nOlá <script>\r\nsegunda linha\r\n\r\n2\r\n00:00:01,500 --> 00:00:02,800\r\nFim', 3);
assert.equal(captions[0].kind, 'caption'); assert.equal(captions[0].start, .2); assert.equal(captions[1].end, 2.8);
assert.equal(captions[0].text, 'Olá <script>\nsegunda linha');
for (const text of ['', '1\n00:00:05,000 --> 00:00:06,000\nFora', '1\n00:00:02,000 --> 00:00:01,000\nInvertida', '1\n00:65:00,000 --> 00:65:01,000\nInválida']) assert.throws(() => parseSrt(text, 3));
assert.deepEqual(wrapText('abcd\nef', 2, text => text.length), ['ab', 'cd', 'ef']);
console.log('Editing: silence/typing suggestions, preserved cuts, SRT validation and text wrapping passed.');

const activity = cursorActivity([{t:0,x:.5,y:.5,down:false},{t:.8,x:.5001,y:.5,down:false},{t:2,x:.6,y:.5,down:true}]);
assert.deepEqual(activity, [0,2]); assert.equal(cursorIdleOpacity(1, activity),1); assert.ok(Math.abs(cursorIdleOpacity(1.1,activity)-.5)<1e-9); assert.equal(cursorIdleOpacity(1.3,activity),0); assert.equal(cursorIdleOpacity(2,activity),1); assert.equal(lastTimeAt(-1,activity), undefined);
