import {webcamMotionState,motionPresets} from '../src/cinematic.ts';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { webcamFocusScale, webcamEase, webcamZoomSize, webcamAt, planWebcamState, type Webcam, type WebcamZoomBehavior } from '../src/webcam.ts';
const keys=[{t:0,scale:1},{t:1,scale:1.65,cut:true},{t:2,scale:1.8},{t:2.5,scale:1.65},{t:3,scale:1,cut:true},{t:5,scale:1}];
function scaleAt(t:number){let i=keys.findIndex(k=>k.t>t);if(i<0)i=keys.length;const a=keys[Math.max(0,i-1)],b=keys[Math.min(i,keys.length-1)],u=b.t>a.t&&!b.cut?Math.max(0,Math.min(1,(t-a.t)/(b.t-a.t))):0;return a.scale+(b.scale-a.scale)*u;}
const cases=[];
for(const duration of [.15,.4,2])for(const behavior of ['keep','shrink','grow','custom'] as WebcamZoomBehavior[])for(const fps of [30,60]){
 let previous=.32;
 for(let i=0;i<=5*fps;i++){
  const t=i/fps,scale=webcamFocusScale(t,scaleAt,duration),size=webcamZoomSize(.32,scale,behavior,.16);
  assert.ok(size>=.08&&size<=.6);
  if(behavior==='keep')assert.ok(Math.abs(size-.32)<1e-12);
  if(t>1+duration&&t<2.5)assert.ok(Math.abs(size-({'keep':.32,'shrink':.208,'grow':.432,'custom':.16}[behavior]))<1e-10);
  // Even an instantaneous screen cut must not cause an instantaneous webcam resize.
  assert.ok(Math.abs(size-previous)<.09);previous=size;
  const camera:Webcam={path:'camera.mov',x:.8,y:.8,size:.32,shape:'rectangle',mode:'static',zoomBehavior:behavior,zoomSize:.16,transitionDuration:duration};
  const state=planWebcamState(webcamAt(camera,t),scale,'9:16');assert.ok(Math.abs(state.size-size)<1e-12);
  cases.push({t,duration,behavior,scale,size,keys,motion:{...motionPresets.cinematic,webcamShake:true,impacts:[1,3]},webcamMotion:webcamMotionState({x:.3,y:.7},t,{...motionPresets.cinematic,webcamShake:true},[1,3]),bezier:webcamEase(t % 1,"cubic-bezier")});
 }
}
const camera:Webcam={path:'camera.mov',x:.8,y:.8,size:.32,shape:'rectangle',mode:'manual',zoomBehavior:'shrink',keyframes:[{t:1,x:.2,y:.3,size:.4,opacity:.2,easing:'ease-in-out'},{t:3,x:.8,y:.7,size:.2,opacity:1,easing:'ease-out'}]};
for(const t of [0,1,1.5,2,2.5,3,4]){const state=webcamAt(camera,t);assert.deepEqual(planWebcamState(state,1.8,'9:16'),state);assert.deepEqual(planWebcamState({...state,mode:'hybrid'},1.8,'16:9'),{...state,mode:'hybrid'});}
assert.equal(webcamAt(camera,2).size,.30000000000000004);
assert.ok(Math.abs(webcamAt(camera,2).opacity-.6)<1e-12);
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(cases));
console.log(`Webcam dynamics: ${cases.length} preview samples, 30/60 FPS, cuts, saturation, transitions, manual priority passed.`);

const legacy={...camera,borderRadius:.27,keyframes:camera.keyframes!.map(({borderRadius:_r,...key})=>key)};
for(const t of [0,2,4])assert.equal(webcamAt(legacy,t).borderRadius,.27,'Legacy keys inherit the configured radius');
