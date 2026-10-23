"""Real-media visual regression fixture. Does not change the source project or zoom engine."""
import copy, json, pathlib, subprocess, sys
root=pathlib.Path(__file__).resolve().parent.parent
out=root/'artifacts/webcam-phase2';out.mkdir(exist_ok=True)
helper=root/'src-tauri/native/FrameNative.app/Contents/MacOS/frame-native'
# Controlled focus/overview trajectory over real footage exercises entry, stable focus and exit.
keys=[dict(t=t,x=.5,y=.5,scale=s) for t,s in [(6,1),(6.7,1),(7.1,1.65),(8,1.65),(8.2,1.8),(8.4,1.65),(9.2,1.65),(9.8,1),(12,1)]]
records=[]
for aspect in ['v','h']:
 base=json.loads((root/f'artifacts/webcam-phase1/{aspect}-large.json').read_text())
 base.update(start=6,end=12,ranges=[dict(start=6,end=12,speed=1)],keys=keys)
 for behavior in ['base','keep','shrink','grow','custom','manual']:
  name=f'{aspect}-{behavior}';job=copy.deepcopy(base);job['destination']=str(out/(name+'.mp4'));job['fps']=60 if aspect=='h' else 30
  camera={**job['webcam'],'size':.36,'x':.8,'y':.8,'zoomBehavior':behavior,'zoomSize':.18,'transitionDuration':.4,'keyframes':[],'mode':'static'}
  if behavior=='base':job.pop('webcam')
  else:
   if behavior=='manual':
    camera.update(mode='manual',zoomBehavior='shrink',keyframes=[dict(t=t,x=x,y=y,size=s,opacity=o,borderRadius=.18,easing='cubic-bezier') for t,x,y,s,o in [(6,.8,.8,.36,1),(8,.2,.7,.18,.5),(10,.5,.8,.48,1),(12,.8,.8,.36,1)]])
   job['webcam']=camera
  file=out/(name+'.json');file.write_text(json.dumps(job))
  with (out/(name+'.log')).open('w') as log:
   p=subprocess.Popen([str(helper),'export',str(file)],stdin=subprocess.PIPE,stdout=log,stderr=subprocess.PIPE,text=True)
   p.wait(timeout=180);p.stdin.close();err=p.stderr.read()
   if p.returncode:raise RuntimeError(name+': '+err+(out/(name+'.log')).read_text())
  print(name,'exported',flush=True)
  if behavior!='base':records.append(dict(name=name,aspect=aspect,camera=camera,width=720 if aspect=='v' else 1280,height=1280 if aspect=='v' else 720,keys=keys))
(out/'cases.json').write_text(json.dumps(records))
