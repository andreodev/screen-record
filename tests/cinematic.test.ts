import assert from 'node:assert/strict';
import { cinematicKeys, cameraMotionFor, cameraMotionBlur, motionImpacts, motionPresets, webcamMotionState } from '../src/cinematic.ts';
import { cameraKeys, cameraFromKeys, defaults, type CameraKey } from '../src/zoom.ts';
import { motionFrames } from '../src/motion.ts';
const zooms=[{id:'in',start:.5,end:2,x:.7,y:.4,scale:2,enabled:true},{id:'pan',start:2,end:3,x:.3,y:.6,scale:2,enabled:true}];
const base=cameraKeys(zooms,5,true,[],true,1,1,false,false,16/9,16/9,.95),saved=JSON.stringify(base);
for(const preset of Object.values(motionPresets)){
 const settings={...preset,shake:preset.style!=='smooth',impacts:[1.2,1.25,1.3,2.4]},keys=cinematicKeys(base,settings,.82,.82);
 assert.deepEqual(keys,cinematicKeys(base,settings,.82,.82));
 assert.equal(JSON.stringify(base),saved,'Original trajectory must not change');
 const impacts=motionImpacts(base,settings.impacts);
 assert.ok(impacts.every((t,i)=>!i||t-impacts[i-1]>=.45),'Impacts must not stack');
 for(let i=0;i<base.length;i++){
  const a=base[i],b=keys[i];assert.equal(a.scale,b.scale,'Shake never resizes the screen or webcam');
  assert.ok(Math.abs(b.x-a.x)*.82*a.scale<=settings.intensity+1e-10);
  assert.ok(Math.abs(b.y-a.y)*.82*a.scale<=settings.intensity*.65+1e-10);
  if(!impacts.some(t=>b.t>t&&b.t<t+settings.duration)||!settings.shake)assert.deepEqual(a,b,'No continuous shake');
 }
 const blur=cameraMotionBlur({...defaults,cameraMotion:preset});
 assert.ok(blur.zoom<=1&&blur.pan<=1);
 const samples=motionFrames(1,keys,[],{start:0,end:5},blur);
 assert.ok(samples.length>=(preset.blur?3:1));
 for(const t of [0,.25,4.8,5])assert.deepEqual(cameraFromKeys(t,keys),cameraFromKeys(t,cinematicKeys(base,settings,.82,.82)));
}
const idle:CameraKey[]=Array.from({length:301},(_,i)=>({t:i/60,x:.5,y:.5,scale:1}));
assert.deepEqual(cinematicKeys(idle,motionPresets.cinematic,.82,.82),idle);
assert.equal(motionImpacts(idle).length,0);
assert.equal(motionFrames(2,idle,[],{start:0,end:5},cameraMotionBlur(defaults)).length,1,'No blur while stopped');
const cuts=cameraKeys([{...zooms[0],instant:true}],4,true);
const shaken=cinematicKeys(cuts,{...motionPresets.dynamic,shake:true,impacts:[.49,.55]},.82,.82);
for(let i=0;i<cuts.length;i++)if(cuts[i].cut)assert.deepEqual(shaken[i],cuts[i],'Instant cuts must remain intact');
console.log("Cinematic motion passed: deterministic impacts, no idle shake/blur, bounded amplitude, cuts, spring and webcam scale independence.");


assert.deepEqual(webcamMotionState({x:.8,y:.8},1.05,motionPresets.cinematic,[1]),{x:.8,y:.8},'Webcam does not inherit screen shake');
assert.notDeepEqual(webcamMotionState({x:.8,y:.8},1.05,{...motionPresets.cinematic,webcamShake:true},[1]),{x:.8,y:.8},'Webcam shake is opt-in');

const clicks=Array.from({length:20},(_,i)=>({t:.8+i*.025,x:.7,y:.4,down:i%2===0}));
assert.deepEqual(motionImpacts(cameraKeys(zooms,5,true,clicks,true)),motionImpacts(cameraKeys(zooms,5,true,[],true)),'Consecutive clicks do not trigger shake');

assert.equal(cameraMotionFor(defaults).style, 'cinematic');
assert.equal(cameraMotionFor(defaults).shake, false, 'Default movement must not add camera oscillation');
assert.equal(cameraMotionFor(defaults).spring, true);
assert.deepEqual(cameraMotionBlur(defaults), { cursor: .25, zoom: .7, pan: .7 }, 'Default motion blur must be perceptible during pans and zooms');
assert.deepEqual(cameraMotionBlur({ ...defaults, cameraMotion: { ...motionPresets.cinematic, blur: false }, motionBlur: { cursor: 0, zoom: 1, pan: 1 } }), { cursor: 0, zoom: 0, pan: 0 }, 'Explicit blur opt-out must be respected');

for (const rate of [30, 60, 120]) {
  const pan: CameraKey[] = Array.from({ length: rate * 5 + 1 }, (_, i) => ({ t: i / rate, x: .3 + .1 * Math.min(4, i / rate), y: .5, scale: 2 }));
  const rendered = cinematicKeys(pan, cameraMotionFor(defaults), .82, .82);
  assert.deepEqual(rendered, pan, 'Inertial camera path must not acquire tremor');
  const exposure = motionFrames(2, rendered, [], { start: 0, end: 5 }, cameraMotionBlur(defaults));
  assert.equal(exposure.length, 5, 'Moving camera needs enough samples for a smooth directional trail');
  const pixels = Math.abs(exposure[0].camera.x - exposure[4].camera.x) * 2 * 1920;
  assert.ok(pixels > 4, 'Default blur must be visible at 1080p');
  assert.equal(motionFrames(4.25, rendered, [], { start: 0, end: 5 }, cameraMotionBlur(defaults)).length, 1, 'Stopped footage must return to a sharp frame');
}
console.log('Motion defaults passed: inertial camera without tremor, visible directional blur and sharp idle frames at 30/60/120 Hz.');
