import {writeFileSync} from 'node:fs';
import {cameraKeys} from '../src/zoom.ts';
import {motionFrames} from '../src/motion.ts';
import type {Clip} from '../src/timeline.ts';

const cursor = [{t: 0, x: .2, y: .3, down: false}, {t: .5, x: .8, y: .7, down: true}, {t: 1, x: .3, y: .2, down: false}];
const zooms = [{id: 'zoom', start: .213, end: .817, x: .8, y: .2, scale: 2, enabled: true}];
const cases = [];
for (const instant of [false, true]) for (const speed of [.25, 1, 4]) for (const hideCursor of [false, true]) for (const effect of ['none', 'cursor', 'zoom', 'pan', 'all']) {
  const keys = cameraKeys(zooms.map(z => ({...z, instant})), 1, true, cursor, true);
  const cuts = keys.filter(k => k.cut).map(k => k.t);
  const blur = {cursor: Number(effect === 'cursor' || effect === 'all'), zoom: Number(effect === 'zoom' || effect === 'all'), pan: Number(effect === 'pan' || effect === 'all')};
  const range: Clip = {start: .213, end: .9, speed, hideCursor};
  for (const t of [.213, .214, .3, .5, .8169, .817, .85]) {
    cases.push({t, keys, cursor, range, blur, cuts, expected: motionFrames(t, keys, cursor, range, blur, cuts)});
  }
}
writeFileSync(process.argv[2], JSON.stringify(cases));
