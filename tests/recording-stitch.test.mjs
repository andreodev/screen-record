import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') { console.log('Native stitch integration: Windows-only.'); process.exit(0); }
const root = fileURLToPath(new URL('../', import.meta.url));
const app = process.env.FRAME_TEST_APP || resolve(root, 'src-tauri/target/debug/screen-studio.exe');
const ffmpeg = resolve(root, 'src-tauri/resources/ffmpeg/ffmpeg.exe');
const ffprobe = resolve(root, 'src-tauri/resources/ffmpeg/ffprobe.exe');
const folder = mkdtempSync(join(tmpdir(), 'frame-recording-stitch-'));
const run = (...args) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { windowsHide:true, timeout:30000 });
const probe = path => JSON.parse(execFileSync(ffprobe, ['-v','error','-show_streams','-show_format','-of','json',path], { windowsHide:true }));
function stitch(name, segments, audioOnly=false) {
  const destination=join(folder,name), job=join(folder,name+'.json');
  writeFileSync(job,JSON.stringify({segments,destination,audioOnly,fps:30}));
  const result=JSON.parse(execFileSync(app,['--media-helper','concat',job],{windowsHide:true,timeout:30000}).toString().trim());
  assert.equal(result.event,'stitched');
  return destination;
}
try {
  const a=join(folder,'a.mov'), b=join(folder,'b.mov');
  for(const [path,color,tone,duration] of [[a,'red',440,.7],[b,'blue',880,.8]]) {
    run('-f','lavfi','-i',`color=c=${color}:size=320x180:rate=30`,'-f','lavfi','-i',`sine=frequency=${tone}:sample_rate=48000`,'-t',String(duration),'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac',path);
  }
  const segments=[{path:a,duration:.7},{path:b,duration:.8}];
  const joined=stitch('recording.mov',segments);
  const info=probe(joined);
  assert(Math.abs(+info.format.duration-1.5)<.05,'Paused wall time must not be inserted');
  assert.equal(info.streams.find(s=>s.codec_type==='video').r_frame_rate,'30/1');
  assert(info.streams.some(s=>s.codec_type==='audio'));
  const pixel=time=>[...run('-ss',String(time),'-i',joined,'-frames:v','1','-vf','scale=1:1','-f','rawvideo','-pix_fmt','rgb24','pipe:1')];
  const first=pixel(.2),second=pixel(1.1);
  assert(first[0]>180&&first[2]<60,'First captured segment missing');
  assert(second[2]>180&&second[0]<60,'Resumed segment missing');
  const voiceA=join(folder,'voice-a.m4a'),voiceB=join(folder,'voice-b.m4a');
  run('-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','0.4','-c:a','aac',voiceA);
  run('-f','lavfi','-i','sine=frequency=660:sample_rate=48000','-t','0.6','-c:a','aac',voiceB);
  const voice=stitch('microphone.m4a',[{path:voiceA,duration:.7},{path:voiceB,duration:.8}],true);
  assert(Math.abs(+probe(voice).format.duration-1.5)<.05,'Microphone tracks must align with the screen timeline');
  const faceA=join(folder,'face-a.mov'),faceB=join(folder,'face-b.mov');
  run('-f','lavfi','-i','color=c=green:size=160x120:rate=30','-t','0.4','-c:v','libx264',faceA);
  run('-f','lavfi','-i','color=c=green:size=160x120:rate=30','-t','0.6','-c:v','libx264',faceB);
  const face=stitch('webcam.mov',[{path:faceA,duration:.7},{path:faceB,duration:.8}]);
  assert(Math.abs(+probe(face).format.duration-1.5)<.05,'Webcam tracks must pad to the screen timeline');
  console.log('Native stitch: pause gap exclusion, segment pixels/order, FPS, source audio, microphone padding and webcam alignment passed.');
} finally {
  assert.equal(dirname(resolve(folder)),resolve(tmpdir()));
  rmSync(folder,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
