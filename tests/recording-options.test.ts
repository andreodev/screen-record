import assert from 'node:assert/strict';
import { normalizeRecordingOptions, microphonePresets, loadRecordingOptions } from '../src/recording-options.ts';

assert.deepEqual(normalizeRecordingOptions(null).microphoneProcessing, microphonePresets.natural);
const explicit = normalizeRecordingOptions({ outputDevice: 'speakers-id', microphoneDevice: 'usb-mic', cameraDevice: 'usb-camera', microphoneProcessing: { ...microphonePresets.noisy, noiseSuppression: false } });
assert.equal(explicit.outputDevice, 'speakers-id'); assert.equal(explicit.microphoneDevice, 'usb-mic'); assert.equal(explicit.cameraDevice, 'usb-camera');
assert.equal(explicit.microphoneProcessing.noiseSuppression, false);
const invalid = normalizeRecordingOptions({ outputDevice: 'bad\0id', microphoneProcessing: { noiseReduction: 100, ratio: NaN, compressor: 'yes' } });
assert.equal(invalid.outputDevice, null); assert.equal(invalid.microphoneProcessing.noiseReduction, 30); assert.equal(invalid.microphoneProcessing.ratio, 3); assert.equal(invalid.microphoneProcessing.compressor, true);
assert.deepEqual(loadRecordingOptions().microphoneProcessing, microphonePresets.natural);
console.log('Recording preferences: natural noise suppression defaults, device IDs, bypass and validation passed.');
