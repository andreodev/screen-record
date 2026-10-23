import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {webcamAt,planWebcamState,webcamFocusScale,webcamFrame,webcamFrameStyle} from '../src/webcam.ts';
const folder=resolve(process.argv[2]),cases=JSON.parse(readFileSync(`${folder}/cases.json`,'utf8')),css=readFileSync('src/webcam.css','utf8');
const cssText=(s:Record<string,unknown>)=>Object.entries(s).map(([k,v])=>`${k.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())}:${typeof v==='number'&&k!=='opacity'?v+'px':v}`).join(';');
const frames=[];
for(const test of cases)for(const t of [0.5,2.5,4.5,...(test.name.endsWith('shrink')?[1.2]:[])]){
 const {width,height,camera,keys,aspect}=test;
 const scaleAt=(time:number)=>{let i=keys.findIndex((k:{t:number})=>k.t>time);if(i<0)i=keys.length;const a=keys[Math.max(0,i-1)],b=keys[Math.min(i,keys.length-1)],u=b.t>a.t&&!b.cut?Math.max(0,Math.min(1,(time-a.t)/(b.t-a.t))):0;return a.scale+(b.scale-a.scale)*u;};
 const scale=webcamFocusScale(6+t,scaleAt,camera.transitionDuration),state=planWebcamState(webcamAt(camera,6+t),scale,aspect==='v'?'9:16':'16:9');
 const frame=webcamFrame(state,width,height,16/9),style=webcamFrameStyle(state,width,height,16/9),name=`${test.name}-${t.toFixed(1)}`,stamp=`t-${t.toFixed(1).padStart(4,'0')}.png`,source=`source/t-${(6+t).toFixed(1).padStart(4,'0')}.png`;
 const html=`<!DOCTYPE html><style>body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:#000}.scene{position:relative;width:${width}px;height:${height}px;overflow:hidden}.base{width:100%;height:100%;display:block}${css}</style><div class="scene"><img class="base" src="${aspect}-base/${stamp}"><div class="webcam-frame" style="left:${frame.left}px;top:${frame.top}px;width:${frame.width}px;height:${frame.height}px"><div class="webcam-visual" style="${cssText({...style,left:0,top:0,width:'100%',height:'100%'})}"><img src="${source}"></div></div></div>`;
 writeFileSync(`${folder}/${name}-preview.html`,html);
 writeFileSync(`${folder}/${name}-export-view.html`,`<!DOCTYPE html><style>body{margin:0;overflow:hidden}img{display:block;width:${width}px;height:${height}px}</style><img src="${test.name}/${stamp}">`);
 frames.push({...test,name,t,frame,state});
}
writeFileSync(`${folder}/frames.json`,JSON.stringify(frames));console.log(`Created ${frames.length} dynamic preview fixtures using the actual webcam evaluator.`);
