import assert from 'node:assert/strict';
import { playMedia, playbackInterrupted } from '../src/playback.ts';

const errors: unknown[] = [];
const report = (error: unknown) => { errors.push(error); };
const abort = new DOMException('The play() request was interrupted by a call to pause().', 'AbortError');
assert.equal(playbackInterrupted(abort), true);
assert.equal(playbackInterrupted({ name: 'AbortError' }), true, 'Cross-realm media exceptions must be recognized');
for (const error of [null, undefined, 'AbortError', new Error('AbortError'), new DOMException('Blocked', 'NotAllowedError')])
  assert.equal(playbackInterrupted(error), false);

await playMedia(null, report);
await playMedia({ play: () => Promise.resolve() }, report);
await playMedia({ play: () => Promise.reject(abort) }, report);
await playMedia({ play: () => { throw abort; } }, report);
assert.deepEqual(errors, [], 'Cancelled playback must not surface as an application error');

const unsupported = new DOMException('Unsupported codec', 'NotSupportedError');
const denied = new DOMException('Playback denied', 'NotAllowedError');
for (const error of [unsupported, denied, new Error('Decoder failure')]) {
  await playMedia({ play: () => Promise.reject(error) }, report);
  assert.equal(errors.at(-1), error, 'Real media errors must still be reported');
}
console.log('Playback: cancelled play/pause, source replacement, cross-realm errors and real failures passed.');
