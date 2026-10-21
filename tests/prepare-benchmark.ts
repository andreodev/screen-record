import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { autoZooms, cameraKeys, defaults, smoothCursor } from '../src/zoom.ts';
const folder = resolve(process.argv[2]);
const duration = Number(process.argv[3] || 600);
const source = join(folder, 'long.mov');
const cursor = Array.from({ length: duration * 120 }, (_, i) => {
  const t = i / 120;
  return { t, x: .5 + .35 * Math.sin(t * .37), y: .5 + .3 * Math.sin(t * .23), down: i % 360 >= 120 && i % 360 < 126 };
});
const start = performance.now(), events = smoothCursor(cursor), smoothed = performance.now();
const zooms = autoZooms(cursor, duration), keys = cameraKeys(zooms, duration, true, events);
writeFileSync(join(folder, 'engine.json'), JSON.stringify({ duration, events: cursor.length, zooms: zooms.length, keys: keys.length, smoothingMs: smoothed - start, trajectoryMs: performance.now() - smoothed }, null, 2));
writeFileSync(join(folder, 'long.cursor.json'), JSON.stringify(cursor));
writeFileSync(join(folder, 'project.frame.json'), JSON.stringify({ version: 1, name: 'Teste de 10 minutos', mediaPath: source, zooms, appearance: defaults, trim: { start: 0, end: duration } }));
writeFileSync(join(folder, 'export-job.json'), JSON.stringify({ source, destination: join(folder, 'long-export.mp4'), start: 0, end: duration, appearance: defaults, keys, cursor: events, cursorCaptured: true }));
