import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { webcamFrame, webcamFrameStyle } from '../src/webcam.ts';
const folder=resolve(process.argv[2]),cases=JSON.parse(readFileSync(`${folder}/cases.json`,'utf8'));
const css=readFileSync('src/webcam.css','utf8');
const cssText=(style:Record<string,unknown>)=>Object.entries(style).map(([key,value])=>`${key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())}:${typeof value==='number'&&key!=='opacity'?value+'px':value}`).join(';');
const frames=[];
for(const test of cases){
 const {camera,width,height,name,aspect}=test;
 const frame=webcamFrame(camera,width,height,16/9),style=webcamFrameStyle(camera,width,height,16/9);
 frames.push({...test,frame});
 const html=`<!DOCTYPE html><style>body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:#000}.scene{position:relative;width:${width}px;height:${height}px;overflow:hidden}.base{width:100%;height:100%;display:block}${css}</style><div class="scene"><img class="base" src="base-${aspect}/t-00.5.png"><div class="webcam-frame" style="left:${frame.left}px;top:${frame.top}px;width:${frame.width}px;height:${frame.height}px"><div class="webcam-visual" style="${cssText({...style,left:0,top:0,width:'100%',height:'100%'})}"><img src="webcam-source/t-06.5.png"></div></div></div>`;
 writeFileSync(`${folder}/${name}-preview.html`,html);
 writeFileSync(`${folder}/${name}-export-view.html`, `<!DOCTYPE html><style>body{margin:0;overflow:hidden}img{display:block;width:${width}px;height:${height}px}</style><img src="${name}/t-00.5.png">`);
}
writeFileSync(`${folder}/frames.json`,JSON.stringify(frames));
console.log(`Created ${cases.length} preview fixtures using the editor geometry and CSS.`);
