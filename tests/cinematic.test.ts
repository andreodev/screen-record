import assert from 'node:assert/strict';
import { cinematicKeys, cameraMotionBlur, motionImpacts, motionPresets, webcamMotionState } from '../src/cinematic.ts';
import { cameraKeys, cameraFromKeys, defaults, type CameraKey } from '../src/zoom.ts';
import { motionFrames } from '../src/motion.ts';
const zooms=[{id:'in',start:.5,end:2,x:.7,y:.4,scale:2,enabled:true},{id:'pan',start:2,end:3,x:.3,y:.6,scale:2,enabled:true}];
const base=cameraKeys(zooms,5,true,[],true,1,1,false,false,16/9,16/9,.95),saved=JSON.stringify(base);
for(const preset of Object.values(motionPresets)){
 const settings={...preset,impacts:[1.2,1.25,1.3,2.4]},keys=cinematicKeys(base,settings,.82,.82);
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
 assert.ok(blur.zoom<=.5&&blur.pan<=.5);
 const samples=motionFrames(1,keys,[],{start:0,end:5},blur);
 assert.ok(samples.length>=(preset.blur?3:1));
 for(const t of [0,.25,4.8,5])assert.deepEqual(cameraFromKeys(t,keys),cameraFromKeys(t,cinematicKeys(base,settings,.82,.82)));
}
const idle:CameraKey[]=Array.from({length:301},(_,i)=>({t:i/60,x:.5,y:.5,scale:1}));
assert.deepEqual(cinematicKeys(idle,motionPresets.cinematic,.82,.82),idle);
assert.equal(motionImpacts(idle).length,0);
assert.equal(motionFrames(2,idle,[],{start:0,end:5},cameraMotionBlur(defaults)).length,1,'No blur while stopped');
const cuts=cameraKeys([{...zooms[0],instant:true}],4,true);
const shaken=cinematicKeys(cuts,{...motionPresets.dynamic,impacts:[.49,.55]},.82,.82);
for(let i=0;i<cuts.length;i++)if(cuts[i].cut)assert.deepEqual(shaken[i],cuts[i],'Instant cuts must remain intact');
console.log("Cinematic motion passed: deterministic impacts, no idle shake/blur, bounded amplitude, cuts, spring and webcam scale independence.");


assert.deepEqual(webcamMotionState({x:.8,y:.8},1.05,motionPresets.cinematic,[1]),{x:.8,y:.8},'Webcam does not inherit screen shake');
assert.notDeepEqual(webcamMotionState({x:.8,y:.8},1.05,{...motionPresets.cinematic,webcamShake:true},[1]),{x:.8,y:.8},'Webcam shake is opt-in');

const clicks=Array.from({length:20},(_,i)=>({t:.8+i*.025,x:.7,y:.4,down:i%2===0}));
assert.deepEqual(motionImpacts(cameraKeys(zooms,5,true,clicks,true)),motionImpacts(cameraKeys(zooms,5,true,[],true)),'Consecutive clicks do not trigger shake');
