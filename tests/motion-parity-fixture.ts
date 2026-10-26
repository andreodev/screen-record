import {writeFileSync} from 'node:fs';
import {cameraKeys} from '../src/zoom.ts';
import {cinematicKeys,motionPresets,cameraMotionBlur,responsiveCursor} from '../src/cinematic.ts';
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
for(const style of ['smooth','cinematic','dynamic'] as const)for(const speed of [.25,1,4])for(const fps of [30,60]){
 const keys=cinematicKeys(cameraKeys(zooms,2,true,cursor,true,1,1,false,false,16/9,16/9,motionPresets[style].damping),{...motionPresets[style],impacts:[.4]},.82,.82);
 const cuts=keys.filter(k=>k.cut).map(k=>k.t),range={start:0,end:2,speed},blur=cameraMotionBlur({background:0,padding:9,radius:12,shadow:35,cursorSize:24,smooth:true,aspect:'16:9',cameraMotion:motionPresets[style]});
 for(let frame=0;frame<fps*2;frame+=3){const t=frame/fps;cases.push({t,keys,cursor,range,blur,cuts,expected:motionFrames(t,keys,cursor,range,blur,cuts)});}
}
for (const button of ['down', 'rightDown', 'middleDown'] as const) {
 const raw=Array.from({length:121},(_,i)=>({t:i/120,x:.2+.5*Math.min(i/120,.8),y:.4,down:false,[button]:i>=60&&i<66}));
 const keys=cameraKeys([],1,true),cursor=responsiveCursor(raw,keys,{style:'dynamic',intensity:1,directionImpact:true});
 const range={start:0,end:1,speed:1},blur={cursor:1,zoom:0,pan:0},cuts:number[]=[];
 for(const t of [.1,.3,.5,.51,.55,.7,.94])cases.push({t,keys,cursor,range,blur,cuts,expected:motionFrames(t,keys,cursor,range,blur,cuts)});
}
writeFileSync(process.argv[2], JSON.stringify(cases));
