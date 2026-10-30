import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { videoFixture } from './video-fixture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const folder = mkdtempSync(join(tmpdir(), 'frame-recorder-'));
const fixture = join(folder, 'source.mp4');
const wait = ms => new Promise(done => setTimeout(done, ms));
let server, browser, socket;
try {
  execFileSync(resolve(root, 'src-tauri/resources/ffmpeg/ffmpeg.exe'), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-t', '2', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', fixture], { windowsHide: true });
  server = await createServer({ root, server: { port: 0, host: '127.0.0.1' }, plugins: [{ name: 'recorder-fixture', configureServer(vite) {
    vite.middlewares.use('/__recorder-fixture.mp4', videoFixture(fixture));
  } }] });
  await server.listen();
  const profile = join(folder, 'browser');
  browser = spawn(process.env.FRAME_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let launchError;
  browser.on('error', error => { launchError = error; });
  const deadline = Date.now() + 20000;
  while (!existsSync(join(profile, 'DevToolsActivePort'))) {
    if (launchError) throw launchError;
    if (Date.now() > deadline) throw new Error('Browser did not start');
    await wait(100);
  }
  const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data), request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    message.error ? request.fail(new Error(JSON.stringify(message.error))) : request.done(message.result);
  };
  const send = (method, params = {}) => new Promise((done, fail) => {
    const request = ++id;
    pending.set(request, { done, fail });
    socket.send(JSON.stringify({ id: request, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const until = async expression => {
    const end = Date.now() + 15000;
    while (!await evaluate(expression)) {
      if (Date.now() > end) throw new Error(`Timed out: ${expression}`);
      await wait(100);
    }
  };
  const media = { path: 'fixture.mp4', duration: 2, width: 640, height: 360, cursor: [], cursorCaptured: false };
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.isTauri = true; window.__uiErrors = []; window.__calls = []; window.__callbacks = {}; window.__listeners = {};
    window.addEventListener('error', e => window.__uiErrors.push(e.message));
    window.addEventListener('unhandledrejection', e => window.__uiErrors.push(String(e.reason)));
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    window.__emit = (event, payload = null) => (window.__listeners[event] || []).forEach(handler => window.__callbacks[handler]({ event, id: handler, payload }));
    let callback = 0;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' } },
      transformCallback: fn => { window.__callbacks[++callback] = fn; return callback; },
      convertFileSrc: file => file === 'fixture.mp4' ? '/__recorder-fixture.mp4' : '/@fs/' + file.replaceAll('\\\\', '/'),
      invoke: async (command, args) => {
        window.__calls.push({ command, args });
        if (command === 'plugin:event|listen') { (window.__listeners[args.event] ||= []).push(args.handler); return args.handler; }
        if (command === 'take_pending_project') return null;
        if (command === 'recent_projects') return [];
        if (command === 'studio_asset_root') return ${JSON.stringify(resolve(root, 'src-tauri/resources/studio-assets'))};
        if (command === 'list_capture_sources') return { displays: [{kind:'display',id:11,label:'Monitor principal · 1920 × 1080',width:1920,height:1080}], windows:[{kind:'window',id:22,label:'Editor de código',width:1280,height:720}] };
        if (command === 'list_recording_devices') return { supported:true, cameras:[{id:'camera-1',label:'Webcam HD',isDefault:true}],inputs:[{id:'mic-1',label:'Microfone USB',isDefault:true}],outputs:[{id:'speaker-1',label:'Alto-falantes',isDefault:true}] };
        if (command === 'import_video') return ${JSON.stringify(media)};
        if (command === 'start_recording' && window.__failRecording) throw new Error('Falha de captura para teste');
        return null;
      }
    };
  ` });
  await send('Emulation.setDeviceMetricsOverride', { width:460,height:370,deviceScaleFactor:1,mobile:false });
  await send('Page.navigate', { url: `http://127.0.0.1:${server.httpServer.address().port}` });
  await until(`document.querySelector('.recorder-start') && !document.querySelector('.recorder-start').disabled`);
  assert.equal(await evaluate(`!!document.querySelector('.editor')`), false, 'Editor must not mount on startup');
  assert(await evaluate(`window.__calls.some(c => c.command === 'set_workspace_mode' && c.args.mode === 'recorder')`));
  const layout = await evaluate(`({ overflow: document.documentElement.scrollWidth > innerWidth, bottom: document.querySelector('.recorder-footer').getBoundingClientRect().bottom })`);
  assert(!layout.overflow && layout.bottom <= 370, JSON.stringify(layout));
  if (process.env.FRAME_RECORDER_SCREENSHOT) {
    const image = await send('Page.captureScreenshot', { format:'png' });
    writeFileSync(process.env.FRAME_RECORDER_SCREENSHOT, Buffer.from(image.data, 'base64'));
  }
  const clickText = async text => evaluate(`[...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(text)})).click()`);
  const setInput = async (label, value) => evaluate(`(() => { const el=document.querySelector('input[aria-label="${label}"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${value}); el.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await clickText('Área');
  await setInput('Área: width', 5000);
  assert(await evaluate(`document.querySelector('.recorder-start').disabled`), 'Invalid area must block recording');
  await setInput('Área: width', 800);
  await setInput('Área: height', 600);
  await evaluate(`document.querySelector('button[role="switch"][aria-label="Webcam"]').click()`);
  await evaluate(`document.querySelector('button[role="switch"][aria-label="Microfone"]').click()`);
  await evaluate(`(() => { const el=document.querySelector('select[aria-label="Dispositivo de webcam"]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'camera-1'); el.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await clickText('Gravar');
  await until(`!document.querySelector('.recorder-launcher') && window.__calls.some(c=>c.command==='start_recording')`);
  const start = await evaluate(`window.__calls.find(c=>c.command==='start_recording').args`);
  assert.equal(start.withWebcam, true); assert.equal(start.withMicrophone, false); assert.equal(start.withSystemAudio, true);
  assert.equal(start.options.cameraDevice, 'camera-1'); assert.equal(start.options.source.kind,'area');
  assert.deepEqual(start.options.source.area,{x:0,y:0,width:800,height:600});
  assert.equal(await evaluate(`!!document.querySelector('.recorder-control, .recorder-stop, .record-clock')`), false, 'No floating recording controls or clock');
  await evaluate(`window.__emit('recording-started'); window.__emit('recording-time',{ seconds:1.5 })`);
  await evaluate(`window.__emit('recording-pausing'); window.__emit('recording-paused')`);
  assert.equal(await evaluate(`!!document.querySelector('.recorder-launcher, .editor, .recorder-control')`), false, 'Pausing keeps the workspace hidden');
  await evaluate(`window.__emit('recording-resuming'); window.__emit('recording-resumed')`);
  await evaluate(`window.__TAURI_INTERNALS__.invoke('stop_operation'); window.__emit('recording-stopping')`);
  assert(await evaluate(`window.__calls.some(c=>c.command==='stop_operation')`));
  assert.equal(await evaluate(`!!document.querySelector('.editor')`), false, 'Stopping must wait for the finalized media');
  await evaluate(`window.__emit('recording-finished',${JSON.stringify(media)})`);
  await send('Emulation.setDeviceMetricsOverride', { width:1280,height:820,deviceScaleFactor:1,mobile:false });
  await until(`document.querySelector('.media-plane video')?.readyState >= 2`);
  assert(await evaluate(`window.__calls.some(c=>c.command==='set_workspace_mode' && c.args.mode==='editor')`));
  assert(await evaluate(`document.querySelector('.scene').getBoundingClientRect().width > 100`), 'Preview observer must attach after launcher-to-editor transition');
  await clickText('Nova gravação');
  await until(`!!document.querySelector('.recorder-launcher')`);
  await clickText('Voltar');
  await until(`!!document.querySelector('.editor')`);
  await clickText('Nova gravação');
  await until(`document.querySelector('.recorder-start') && !document.querySelector('.recorder-start').disabled`);
  await evaluate(`window.__failRecording = true`);
  await clickText('Janela');
  await clickText('Gravar');
  await until(`document.querySelector('.recorder-feedback')?.textContent.includes('Falha de captura')`);
  assert.equal(await evaluate(`!!document.querySelector('.recorder-control')`), false, 'Failed starts return to setup');
  await clickText('Importar vídeo');
  await until(`!!document.querySelector('.editor')`);
  assert.deepEqual(await evaluate('window.__uiErrors'), []);
  console.log('Recorder: compact setup, validated areas/devices, hidden capture, pause/resume/stop events, finalization-to-editor, return, errors and import passed.');
} finally {
  if (socket?.readyState === WebSocket.OPEN) { socket.send(JSON.stringify({ id:99999,method:'Browser.close' })); socket.close(); }
  if (browser) { await Promise.race([new Promise(done=>browser.once('close',done)),wait(3000)]); if (browser.exitCode===null) browser.kill(); }
  await server?.close();
  assert.equal(dirname(resolve(folder)),resolve(tmpdir()));
  rmSync(folder,{recursive:true,force:true,maxRetries:10,retryDelay:200});
}
