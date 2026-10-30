// Real Tauri/WebView2 test with an opt-in debug media fixture.
// Never captures the user's screen, microphone or camera.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { createServer as createPort } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

if (process.platform !== 'win32') process.exit(0);
const root = fileURLToPath(new URL('../', import.meta.url));
const folder = mkdtempSync(join(tmpdir(), 'frame-tray-test-'));
const app = resolve(root,'src-tauri/target/debug/screen-studio.exe');
const ffmpeg = resolve(root,'src-tauri/resources/ffmpeg/ffmpeg.exe');
const fixture = join(folder,'fixture.mp4'), project = join(folder,'Take.framestudio');
const wait=ms=>new Promise(done=>setTimeout(done,ms));
let server, child, socket, evaluate;
try {
  execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=30','-t','8','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',fixture],{windowsHide:true});
  const config=join(folder,'benchmark.json');
  writeFileSync(config,JSON.stringify({mode:'recording-test',recordFixture:fixture,recordingProject:project}));
  try {
    server=await createServer({root,server:{host:'localhost',port:1420,strictPort:true}});
    await server.listen();
  } catch(error) {
    await server?.close(); server=undefined;
    const response=await fetch('http://localhost:1420/src/App.tsx');
    assert(response.ok && (await response.text()).includes('useEditorController'),'Port 1420 belongs to another application');
  }
  const listener=createPort();
  await new Promise(done=>listener.listen(0,'127.0.0.1',done));
  const port=listener.address().port;
  await new Promise(done=>listener.close(done));
  child=spawn(app,[],{windowsHide:true,stdio:'ignore',env:{
    ...process.env,FRAME_STUDIO_BENCHMARK:config,
    APPDATA:join(folder,'app-data'),LOCALAPPDATA:join(folder,'local-data'),
    WEBVIEW2_USER_DATA_FOLDER:join(folder,'webview'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`,
  }});
  let launchError; child.on('error',error=>{launchError=error;});
  let page; const deadline=Date.now()+30000;
  while(!page) {
    if(launchError)throw launchError;
    assert.equal(child.exitCode,null,'Native app exited');
    try { page=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p=>p.type==='page'); } catch {}
    if(Date.now()>deadline)throw new Error('Native WebView did not start');
    if(!page)await wait(100);
  }
  socket=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done,fail)=>{socket.onopen=done;socket.onerror=fail;});
  let id=0;const pending=new Map();
  socket.onmessage=event=>{const message=JSON.parse(event.data),request=pending.get(message.id);if(!request)return;pending.delete(message.id);message.error?request.fail(new Error(JSON.stringify(message.error))):request.done(message.result);};
  const send=(method,params={})=>new Promise((done,fail)=>{const request=++id;pending.set(request,{done,fail});socket.send(JSON.stringify({id:request,method,params}));});
  evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
  const until=async expression=>{const end=Date.now()+30000;while(!await evaluate(expression)){if(Date.now()>end)throw new Error(`Timed out: ${expression}`);await wait(100);}};
  await until(`!!document.querySelector('.recorder-start')`);
  await evaluate(`(async()=>{ window.__events=[]; window.__errors=[]; window.addEventListener('unhandledrejection',e=>window.__errors.push(String(e.reason))); for(const event of ['recording-started','recording-paused','recording-resumed','recording-finished','operation-error']){const handler=window.__TAURI_INTERNALS__.transformCallback(data=>window.__events.push(data));await window.__TAURI_INTERNALS__.invoke('plugin:event|listen',{event,target:{kind:'Any'},handler});}})()`);
  const initialSize=await evaluate(`window.__TAURI_INTERNALS__.invoke('plugin:window|inner_size',{label:'main'})`);
  assert(initialSize.width<=690&&initialSize.height<=555,`Launcher must be compact: ${JSON.stringify(initialSize)}`);
  await evaluate(`window.__TAURI_INTERNALS__.invoke('set_workspace_mode',{mode:'recording'})`);
  await evaluate(`window.__TAURI_INTERNALS__.invoke('start_recording',{withWebcam:false,withMicrophone:false,withSystemAudio:false,options:{resolution:1080,fps:30}})`);
  await until(`window.__events.some(e=>e.event==='recording-started')`);
  assert.equal(await evaluate(`window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible',{label:'main'})`),false);
  await wait(450);
  await evaluate(`window.__TAURI_INTERNALS__.invoke('toggle_recording_pause')`);
  await until(`window.__events.some(e=>e.event==='recording-paused')`);
  assert.equal(await evaluate(`!!document.querySelector('.recorder-control, .record-clock, .recorder-stop')`),false);
  const children=execFileSync('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${child.pid}' | Select-Object -ExpandProperty CommandLine`],{windowsHide:true}).toString();
  assert(!children.includes('--media-helper record'),'No capture worker may remain alive during pause');
  await evaluate(`window.__TAURI_INTERNALS__.invoke('toggle_recording_pause')`);
  await until(`window.__events.some(e=>e.event==='recording-resumed')`);
  await wait(450);
  await evaluate(`window.__TAURI_INTERNALS__.invoke('toggle_recording_pause')`);
  await until(`window.__events.filter(e=>e.event==='recording-paused').length===2`);
  await evaluate(`window.__TAURI_INTERNALS__.invoke('stop_operation')`);
  await until(`window.__events.some(e=>e.event==='recording-finished')`);
  await until(`!!document.querySelector('.editor')`);
  await until(`window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible',{label:'main'})`);
  const events=await evaluate('window.__events');
  const media=events.find(e=>e.event==='recording-finished').payload;
  assert.equal(events.filter(e=>e.event==='recording-started').length,1);
  assert.equal(events.filter(e=>e.event==='recording-resumed').length,1);
  assert.equal(events.filter(e=>e.event==='operation-error').length,0,JSON.stringify(events));
  assert(media.duration>0.6&&media.duration<3,'Pause wall time must be absent from final media');
  assert.equal(media.cursor.length,4,'Cursor events from both segments must be retained');
  assert(media.cursor.every((p,i)=>!i||p.t>=media.cursor[i-1].t));
  assert(existsSync(join(project,'media/recording.mov')));
  assert(existsSync(join(project,'project.json')));
  assert(!existsSync(join(project,'media/.parts')),'Temporary segments must be cleaned only after final assembly');
  assert.deepEqual(await evaluate('window.__errors'),[]);
  console.log('Native tray lifecycle: compact window, hidden capture, pause ends worker, resume, stop while paused, joined media/cursor and editor restore passed without capturing real devices.');
} finally {
  if(child&&child.exitCode===null&&evaluate) {
    try { await evaluate(`window.__TAURI_INTERNALS__.invoke('workspace_window_action',{action:'close'})`); } catch {}
    await Promise.race([new Promise(done=>child.once('close',done)),wait(5000)]);
  }
  socket?.close();
  if(child&&child.exitCode===null)child.kill();
  await server?.close();
  assert.equal(dirname(resolve(folder)),resolve(tmpdir()));
  rmSync(folder,{recursive:true,force:true,maxRetries:20,retryDelay:250});
}
