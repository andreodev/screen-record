import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {cameraKeys,frameLayout,cameraFromKeys} from '../src/zoom.ts';
import {cinematicKeys,motionPresets,motionImpacts,cameraMotionBlur} from '../src/cinematic.ts';
const out=resolve(process.argv[2]);mkdirSync(out,{recursive:true});
const cases=[];
for(const aspect of ['v','h']){
 const base=JSON.parse(readFileSync(`artifacts/webcam-phase1/${aspect}-large.json`,'utf8')),width=aspect==='v'?720:1280,height=aspect==='v'?1280:720,sourceAspect=1440/900;
 const padding=Math.min(width,height)*base.appearance.padding/100,contentAspect=(width-2*padding)/(height-2*padding),layout=frameLayout(sourceAspect,contentAspect,false),frameWidth=layout.width*(width-2*padding)/width,frameHeight=layout.height*(height-2*padding)/height;
 const zooms=[{id:'zoom-in',start:6.4,end:8.8,x:.35,y:.4,scale:aspect==='v'?3:1.8,enabled:true},{id:'focus-pan',start:8.5,end:10.3,x:.72,y:.6,scale:aspect==='v'?3:2.2,enabled:true}];
 for(const style of ['off','cinematic','dynamic','webcam-shake']){
  const options={...(style==='dynamic'?motionPresets.dynamic:motionPresets.cinematic),webcamShake:style==='webcam-shake',impacts:[8.8]};
  if(style==='off'){options.spring=false;options.shake=false;options.blur=false;}
  const planned=cameraKeys(zooms,14,true,base.cursor,options.spring,1,1,false,false,sourceAspect,contentAspect,options.damping),keys=cinematicKeys(planned,options,frameWidth,frameHeight),impacts=motionImpacts(planned,options.impacts);
  const name=`${aspect}-${style}`,appearance={...base.appearance,cameraMotion:{...options,impacts},motionBlur:cameraMotionBlur({...base.appearance,cameraMotion:options})};
  const webcam={...base.webcam,x:.8,y:.8,size:.36,mode:'static',keyframes:[],zoomBehavior:'shrink',transitionDuration:.4};
  const job={...base,start:6,end:14,ranges:[{start:6,end:14,speed:1}],appearance,keys,webcam,fps:aspect==='v'?30:60,destination:`${out}/${name}.mp4`};
  writeFileSync(`${out}/${name}.json`,JSON.stringify(job));
  cases.push({name,width,height,options,impacts,frameWidth,frameHeight,keys,planned,job: `${name}.json`});
 }
}
writeFileSync(`${out}/cases.json`,JSON.stringify(cases));console.log(`Prepared ${cases.length} real-media cinematic jobs.`);
