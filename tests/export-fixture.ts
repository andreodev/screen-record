import { writeFileSync } from 'node:fs';
import { cameraKeys, defaults } from '../src/zoom.ts';
const [source, destination, jobFile] = process.argv.slice(2);
if (!source || !destination || !jobFile) throw new Error('Usage: export-fixture.ts source destination job.json');
const job = { source, destination, start: .3, end: 2.5, appearance: defaults, keys: cameraKeys([{ id: 'test', start: .4, end: 2.4, x: .2, y: .7, scale: 1.8, enabled: true }], 3, true), cursor: [{t:0,x:.2,y:.7,down:false},{t:1,x:.2,y:.7,down:true},{t:3,x:.8,y:.2,down:false}], cursorCaptured: true };
writeFileSync(jobFile, JSON.stringify(job));
