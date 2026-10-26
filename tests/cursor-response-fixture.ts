import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { responsiveCursor, cinematicKeys, motionPresets } from '../src/cinematic.ts';
import { cameraKeys, defaults, smoothCursor, type CursorEvent } from '../src/zoom.ts';

const [source, directory, target] = process.argv.slice(2);
const paths = {
  horizontal: (t: number) => ({ x: .2 + .2 * Math.min(t, 2), y: .5 }),
  diagonal: (t: number) => ({ x: .2 + .3 * Math.min(t, 2), y: .2 + .25 * Math.min(t, 2) }),
  reversal: (t: number) => ({ x: t < 1 ? .2 + .5 * t : t < 2 ? .7 - .5 * (t - 1) : .2, y: .5 }),
  typing: (_t: number) => ({ x: .5, y: .5 }),
};
const jobs = Object.entries(paths).map(([name, position]) => {
  const rawCursor: CursorEvent[] = Array.from({ length: 361 }, (_, i) => ({ t: i / 120, ...position(i / 120), down: name === 'diagonal' && i >= 180 && i < 186, typing: name === 'typing' }));
  const softened = smoothCursor(rawCursor);
  const base = cameraKeys([], 3, true);
  const keys = cinematicKeys(base, motionPresets.smooth);
  const response = { style: 'dynamic', intensity: 1, directionImpact: true } as const;
  const appearance = { ...defaults, aspect: '16:9', cursorSize: 40, cursorResponse: response, padding: 0, radius: 0, shadow: 0, clickSounds: false, clickEffect: 'none', hideIdleCursor: false, motionBlur: { cursor: .35, zoom: 0, pan: 0 } };
  return { name, source, destination: resolve(directory, `cursor-${name}.mp4`), start: 0, end: 3, resolution: 720, fps: 30, appearance, keys, cursor: responsiveCursor(softened, keys, response, .9, 1), rawCursor, plainCursor: softened, cursorCaptured: true, assetsRoot: resolve('src-tauri/resources/studio-assets') };
});
writeFileSync(target, JSON.stringify(jobs));
