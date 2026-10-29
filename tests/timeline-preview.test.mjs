import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { defaults } from '../src/zoom.ts';
import { videoFixture } from './video-fixture.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const folder = mkdtempSync(join(tmpdir(), 'frame-timeline-preview-'));
const fixture = join(folder, 'source.mp4');
const wait = ms => new Promise(done => setTimeout(done, ms));
let server, browser, socket;
try {
  execFileSync(resolve(root, 'src-tauri/resources/ffmpeg/ffmpeg.exe'), ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '12.167', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', fixture], { windowsHide: true });
  server = await createServer({ root, server: { port: 0, host: '127.0.0.1' }, plugins: [{ name: 'timeline-fixture', configureServer(vite) {
    vite.middlewares.use('/__timeline-fixture.mp4', videoFixture(fixture));
  } }] });
  await server.listen();
  const profile = join(folder, 'browser');
  browser = spawn(process.env.FRAME_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let browserError;
  browser.on('error', error => { browserError = error; });
  const deadline = Date.now() + 20000;
  while (!existsSync(join(profile, 'DevToolsActivePort'))) {
    if (browserError) throw browserError;
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
  await send('Page.enable');
  const media = { path: 'fixture.mp4', width: 640, height: 360, duration: 12.167, cursorCaptured: true, cursor: Array.from({ length: 1461 }, (_, i) => ({ t: i / 120, x: .5 + .25 * Math.sin(Math.min(i, 480) / 80), y: .5, down: false })) };
  const project = { version: 13, name: 'Timeline test', mediaPath: media.path, trim: { start: 0, end: media.duration }, microphone: { path: 'fixture.mp4', volume: 1 }, backgroundAudio: { path: 'fixture.mp4', volume: .2 }, webcam: { path: 'fixture.mp4', x: .8, y: .8, size: .2, shape: 'circle' }, zooms: [{ id: 'auto-0', start: .5, end: 3, x: .6, y: .5, scale: 1.65, follow: true, enabled: true }, { id: 'manual-1', start: 7, end: 10, x: .4, y: .5, scale: 2, enabled: true }], appearance: { ...defaults } };
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.isTauri = true; window.__uiErrors = []; window.addEventListener('error', event => window.__uiErrors.push(event.message));
    window.addEventListener('unhandledrejection', event => window.__uiErrors.push(String(event.reason)));
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    const fixture = ${JSON.stringify({ media, project, path: '' })}; let loaded = false;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' } }, transformCallback: () => 0,
      convertFileSrc: file => file === 'fixture.mp4' ? '/__timeline-fixture.mp4' : '/@fs/' + file.replaceAll('\\\\', '/'),
      invoke: async (command, args) => {
        if (command === 'take_pending_project') { if (loaded) return null; loaded = true; return fixture; }
        if (command === 'studio_asset_root') return ${JSON.stringify(resolve(root, 'src-tauri/resources/studio-assets'))};
        if (command === 'recent_projects') return [];
        if (command === 'list_recording_devices') return { supported: false, inputs: [], outputs: [], cameras: [] };
        if (command === 'export_video') { window.__exportSettings = args.settings; return false; }
        return null;
      }
    };` });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${server.httpServer.address().port}` });
  await until(`document.querySelector('.media-plane video')?.readyState >= 2 && document.querySelector('.rendered-cursor img')?.naturalWidth > 0`);

  for (const [width, height] of [[1920, 1080], [1280, 720], [1024, 640], [900, 610]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await wait(150);
    const layout = await evaluate(`(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
      return { timeline: rect('.timeline'), heading: rect('.timeline-heading'), zoom: rect('.zoom-track'), footer: rect('.statusbar'), tracks: rect('.tracks'), ruler: rect('.ruler'), clip: rect('.clip-lane'), scroll: rect('.timeline-scroll'), scene: rect('.scene'), area: rect('.preview-area'), transport: rect('.transport'), areaOverflow: getComputedStyle(document.querySelector('.preview-area')).overflow, labels: [...document.querySelectorAll('.tracks [data-label]')].map(node => getComputedStyle(node, '::before').content), bodyOverflow: document.documentElement.scrollWidth > innerWidth };
    })()`);
    assert(layout.zoom.bottom <= layout.footer.top, `Zoom overlaps footer at ${width}x${height}: ${JSON.stringify(layout)}`);
    assert(layout.zoom.bottom <= layout.scroll.bottom && layout.zoom.top >= layout.heading.bottom, 'Zoom must be fully visible');
    assert(layout.footer.bottom <= height + 1, 'Footer must fit the window');
    assert(Math.abs(layout.ruler.left - layout.clip.left) < 1 && Math.abs(layout.ruler.width - layout.clip.width) < 1, 'Ruler and all lanes must align');
    assert.equal(layout.bodyOverflow, false, 'Timeline actions must not overflow horizontally');
    assert.equal(layout.labels.length, 4, 'Video, microphone, music and effects need separate labels');
    assert(layout.scene.bottom <= layout.transport.top + 1 && layout.transport.bottom <= layout.timeline.top + 1, `Preview overlaps timeline at ${width}x${height}: ${JSON.stringify(layout)}`);
  }

  await evaluate(`document.querySelector('.zoom-block').click()`);
  await until(`!!document.querySelector('.zoom-block[aria-pressed="true"]')`);
  const rect = await evaluate(`document.querySelector('.zoom-block').getBoundingClientRect().toJSON()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: rect.x + rect.width / 2 + 40, y: rect.y + rect.height / 2, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: rect.x + rect.width / 2 + 40, y: rect.y + rect.height / 2, button: 'left', clickCount: 1 });
  assert(await evaluate(`document.querySelector('.zoom-block').getBoundingClientRect().x`) > rect.x + 30, 'Dragging zoom must still edit its timing');
  await evaluate(`document.querySelector('button[aria-label="Animações"]').click()`);
  assert.equal(await evaluate(`[...document.querySelectorAll('label')].find(node => node.textContent.trim().startsWith('Motion Blur')).querySelector('input').checked`), true);
  await evaluate(`(() => { const slider = document.querySelector('.seek-range'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, 2.2); slider.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await until(`!document.querySelector('.motion-preview').hidden`);
  assert.equal(await evaluate(`[...document.querySelectorAll('label')].find(node => node.textContent.trim().startsWith('Micro-Shake')).querySelector('input').checked`), false);
  await evaluate(`document.querySelector('.header-actions .export-button').click()`);
  await until(`document.querySelector('.export-dialog').open`);
  await evaluate(`document.querySelector('.export-dialog form').requestSubmit()`);
  const exported = await evaluate('window.__exportSettings');
  assert.equal(exported.appearance.cameraMotion.shake, false);
  assert.deepEqual(exported.appearance.motionBlur, { cursor: .25, zoom: .7, pan: .7 });
  await evaluate(`(() => { const slider = document.querySelector('.seek-range'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(slider, 6.5); slider.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await until(`document.querySelector('.media-plane video').currentTime > 6.4 && document.querySelector('.motion-preview').hidden`);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.media-plane video')).visibility`), 'visible', 'Still frames must use sharp native video');
  // A pause can arrive before the browser resolves play(), including on companion tracks.
  await evaluate(`(() => { const button = document.querySelector('.play-button'); for (let i = 0; i < 8; i++) { button.click(); button.click(); } })()`);
  await wait(200);
  assert.equal(await evaluate(`document.querySelector('.error-text')?.textContent || ''`), '', 'Quick play/pause must not show AbortError');
  await evaluate(`document.querySelector('.play-button').click()`);
  await until(`!document.querySelector('.media-plane video').paused && !document.querySelector('audio[aria-label="Áudio do microfone"]').paused && !document.querySelector('.webcam-visual video').paused`);
  await evaluate(`document.querySelector('.play-button').click()`);
  await until(`[...document.querySelectorAll('.media-plane video, .media-plane audio:not([hidden]), .webcam-visual video')].every(media => media.paused)`);
  await evaluate(`(() => { const button = document.querySelector('.play-button'); button.click(); document.querySelector('button[title="Adicionar desfoque no marcador"]').click(); })()`);
  await wait(200);
  assert.equal(await evaluate(`document.querySelector('.error-text')?.textContent || ''`), '', 'Editing immediately after play must not report a cancelled playback request');
  await evaluate(`document.querySelector('.media-plane video').pause()`);
  await wait(100);
  assert.deepEqual(await evaluate('window.__uiErrors'), []);
  if (process.env.FRAME_TIMELINE_SCREENSHOT) {
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
    await wait(200);
    const capture = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(process.env.FRAME_TIMELINE_SCREENSHOT, Buffer.from(capture.data, 'base64'));
  }
  console.log('Browser: timeline fits 1920/1280/1024/900 widths, preview/lanes align, selection/drag work, default inertial motion blur and matching export settings passed.');
} finally {
  if (socket?.readyState === WebSocket.OPEN) { socket.send(JSON.stringify({ id: 99999, method: 'Browser.close' })); socket.close(); }
  if (browser) { await Promise.race([new Promise(done => browser.once('close', done)), wait(3000)]); if (browser.exitCode === null) browser.kill(); }
  await server?.close();
  assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
  rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
