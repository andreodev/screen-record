import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { webcamFrame, type WebcamShape } from '../src/webcam.ts';
const cases = [];
for (const [width,height] of [[720,1280],[1280,720]]) for (const shape of ['circle','rounded','square','rectangle'] as WebcamShape[]) for (const [x,y] of [[0,0],[1,1],[.5,0],[.5,1],[.4,.6]]) for (const size of [.08,.24,.6]) for (const sourceAspect of [4/3,9/16]) {
 const camera={x,y,size,shape},frame=webcamFrame(camera,width,height,sourceAspect);
 assert.ok(frame.left >= Math.min(width,height)*.025-1e-8 && frame.top >= Math.min(width,height)*.025-1e-8);
 assert.ok(frame.left+frame.width<=width-Math.min(width,height)*.025+1e-8 && frame.top+frame.height<=height-Math.min(width,height)*.025+1e-8);
 if(shape==='rectangle') assert.ok(Math.abs(frame.width/frame.height-sourceAspect)<1e-8);
 const doubled=webcamFrame(camera,width*2,height*2,sourceAspect);
 assert.ok(Math.abs(doubled.left-frame.left*2)<1e-8 && Math.abs(doubled.height-frame.height*2)<1e-8);
 cases.push({camera,width,height,sourceAspect,frame});
}
if(process.argv[2])writeFileSync(process.argv[2],JSON.stringify(cases));
console.log(`Webcam geometry passed: ${cases.length} cases, source aspect, safe margins and resolution independence.`);
