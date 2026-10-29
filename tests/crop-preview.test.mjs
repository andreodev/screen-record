import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Real Chromium interaction and pixels, with only the Tauri bridge replaced.
const root = fileURLToPath(new URL('../', import.meta.url));
const browserPath = process.env.FRAME_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const folder = mkdtempSync(join(tmpdir(), 'frame-crop-preview-'));
const ffmpeg = resolve(root, 'src-tauri/resources/ffmpeg/ffmpeg.exe');
const fixture = join(folder, 'source.mp4');
const wait = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));
let server, browser, socket;
try {
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:size=320x180:rate=30,drawbox=x=160:y=0:w=160:h=180:color=blue:t=fill', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', fixture], { windowsHide: true });
  server = await createServer({ root, server: { port: 0, strictPort: false, host: '127.0.0.1' }, plugins: [{ name: 'crop-test-fixture', configureServer(vite) {
    vite.middlewares.use('/__crop-fixture.mp4', (_request, response) => { response.setHeader('Content-Type', 'video/mp4'); createReadStream(fixture).pipe(response); });
  } }] });
  await server.listen();
  const url = `http://127.0.0.1:${server.httpServer.address().port}`;
  const profile = join(folder, 'browser');
  browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1280,900', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  browser.on('error', error => { throw error; });
  const portFile = join(profile, 'DevToolsActivePort');
  const deadline = Date.now() + 20000;
  while (!existsSync(portFile)) { if (Date.now() > deadline) throw new Error('Browser did not start'); await wait(100); }
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => { socket.onopen = resolveOpen; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const { resolveResult, reject } = pending.get(message.id); pending.delete(message.id); message.error ? reject(new Error(JSON.stringify(message.error))) : resolveResult(message.result); } };
  const send = (method, params = {}) => new Promise((resolveResult, reject) => { const request = ++id; pending.set(request, { resolveResult, reject }); socket.send(JSON.stringify({ id: request, method, params })); });
  await send('Page.enable');
  await send('Runtime.enable');
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const until = async expression => { const end = Date.now() + 15000; while (!await evaluate(expression)) { if (Date.now() > end) throw new Error(`Timed out: ${expression}\n${await evaluate('document.body.innerText')}`); await wait(100); } };
  const click = text => evaluate(`[...document.querySelectorAll('button')].find(button => button.textContent.trim() === ${JSON.stringify(text)}).click()`);
  const media = { path: 'fixture.mp4', width: 320, height: 180, duration: 3, cursorCaptured: true, cursor: Array.from({ length: 181 }, (_, i) => ({ t: i / 60, x: .7 + .05 * Math.sin(i / 20), y: .5, kind: i < 60 ? 'pointer' : i < 120 ? 'hand' : 'text', down: i === 40 })) };
  const project = { version: 13, name: 'Crop UI test', mediaPath: media.path, trim: { start: 0, end: 3 }, zooms: [{ id: 'manual-test', start: .1, end: 2.8, x: .72, y: .5, scale: 1.65, enabled: true }], appearance: { background: 0, padding: 0, radius: 0, shadow: 0, cursorSize: 32, cursorTheme: 'macos', smooth: true, aspect: 'auto', cursorFollow: 'off', motionBlur: { cursor: 1, zoom: 1, pan: 1 } } };
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.isTauri = true; window.__uiErrors = []; window.addEventListener('error', event => window.__uiErrors.push(event.message));
    const fixture = ${JSON.stringify({ media, project, path: '' })}; let loaded = false;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' } }, transformCallback: () => 0,
      convertFileSrc: file => file === 'fixture.mp4' ? '/__crop-fixture.mp4' : '/@fs/' + file.replaceAll('\\\\', '/'),
      invoke: async (command, args) => {
        if (command === 'take_pending_project') { if (loaded) return null; loaded = true; return fixture; }
        if (command === 'studio_asset_root') return ${JSON.stringify(resolve(root, 'src-tauri/resources/studio-assets'))};
        if (command === 'recent_projects') return [];
        if (command === 'list_recording_devices') return { supported: false, inputs: [], outputs: [], cameras: [] };
        if (command === 'export_video') { window.__exportSettings = args.settings; return false; }
        return null;
      }
    };` });
  await send('Page.navigate', { url });
  await until(`document.querySelector('.media-plane video')?.readyState >= 2 && document.querySelector('.rendered-cursor img')?.naturalWidth > 0`);
  await click('⌗ Crop');
  await until(`document.querySelector('.crop-dialog')?.open`);
  await click('9:16');
  const before = await evaluate(`document.querySelector('.crop-selection').getBoundingClientRect().toJSON()`);
  const drag = async (selector, dx, dy) => {
    const rect = await evaluate(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`);
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + dx, y: y + dy, buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx, y: y + dy, button: 'left', clickCount: 1 });
  };
  await drag('.crop-move', 70, 0);
  const moved = await evaluate(`document.querySelector('.crop-selection').getBoundingClientRect().toJSON()`);
  assert(moved.left > before.left + 50, 'Selection did not move');
  await drag('.crop-handle-nw', 25, 20);
  const resized = await evaluate(`document.querySelector('.crop-selection').getBoundingClientRect().toJSON()`);
  assert(resized.width < moved.width - 10 && resized.height < moved.height - 10, 'Selection did not resize');
  await click('Aplicar recorte');
  await until(`!document.querySelector('.crop-dialog')`);
  const ratio = await evaluate(`document.querySelector('.scene').clientWidth / document.querySelector('.scene').clientHeight`);
  assert(Math.abs(ratio - resized.width / resized.height) < .01, 'Preview aspect does not match selection');
  await click('⌗ Crop'); await click('Vídeo inteiro'); await click('Cancelar');
  assert(Math.abs(await evaluate(`document.querySelector('.scene').clientWidth / document.querySelector('.scene').clientHeight`) - ratio) < .01, 'Cancel changed the crop');
  await evaluate(`document.querySelector('.media-plane video').currentTime = .6`); await wait(250);
  const blur = await evaluate(`(() => { const canvas = document.querySelector('.motion-preview'), video = document.querySelector('.media-plane video'); const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data; let cursorPixels = 0; for (let i = 0; i < data.length; i += 4) if (data[i] > 180 && data[i+1] > 180 && data[i+2] > 180) cursorPixels++; return { canvasHidden: canvas.hidden, videoVisibility: getComputedStyle(video).visibility, cursorPixels }; })()`);
  assert.equal(blur.canvasHidden, false); assert.equal(blur.videoVisibility, 'hidden'); assert(blur.cursorPixels > 10, JSON.stringify(blur));
  await evaluate(`document.querySelector('.header-actions .export-button').click()`);
  await until(`document.querySelector('.export-dialog').open`);
  await evaluate(`document.querySelector('.export-dialog form').requestSubmit()`);
  const exported = await evaluate('window.__exportSettings');
  assert(exported.appearance.crop && exported.appearance.crop.width < 1, 'Export lost selected crop');
  assert(exported.keys.every(key => key.x >= exported.appearance.crop.x && key.x <= exported.appearance.crop.x + exported.appearance.crop.width), 'Export camera left crop');
  await click('⌗ Crop'); await click('Vídeo inteiro'); await click('Aplicar recorte');
  assert(Math.abs(await evaluate(`document.querySelector('.scene').clientWidth / document.querySelector('.scene').clientHeight`) - 16 / 9) < .01, 'Reset did not restore source aspect');
  assert.deepEqual(await evaluate('window.__uiErrors'), []);
  if (process.env.FRAME_TEST_SCREENSHOT) { await click('⌗ Crop'); const capture = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(process.env.FRAME_TEST_SCREENSHOT, Buffer.from(capture.data, 'base64')); }
  console.log('Browser: crop modal, move/resize, apply/cancel/reset, export settings and motion-blur cursor pixels passed.');
} finally {
  if (socket?.readyState === WebSocket.OPEN) { socket.send(JSON.stringify({ id: 99999, method: 'Browser.close' })); socket.close(); }
  if (browser) { await Promise.race([new Promise(resolveClose => browser.once('close', resolveClose)), wait(3000)]); if (browser.exitCode === null) browser.kill(); }
  await server?.close();
  assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
  rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
