import assert from 'node:assert/strict';
import { assetPath } from '../src/asset-path.ts';

assert.equal(assetPath('\\\\?\\C:\\Frame Studio\\assets', 'c137.png'), '\\\\?\\C:\\Frame Studio\\assets\\c137.png');
assert.equal(assetPath('\\\\?\\UNC\\server\\share\\', 'sets/cursor.png'), '\\\\?\\UNC\\server\\share\\sets\\cursor.png');
assert.equal(assetPath('C:\\assets\\', 'sets/cursor.png'), 'C:\\assets\\sets\\cursor.png');
assert.equal(assetPath('/Applications/Frame Studio/assets/', 'sets/cursor.png'), '/Applications/Frame Studio/assets/sets/cursor.png');
console.log('Asset paths: Windows verbatim, UNC, drive and macOS paths passed.');
