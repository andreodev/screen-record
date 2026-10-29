import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') process.exit(0);
const root = fileURLToPath(new URL('../', import.meta.url));
const installer = resolve(root, 'artifacts/windows/Frame-Studio-Setup.exe');
assert(existsSync(installer), 'Build the Windows installer first');
const folder = mkdtempSync(join(tmpdir(), 'frame-release-check-'));
const destination = resolve(root, 'src-tauri/target/release');
const app = join(destination, 'screen-studio.exe');
const wait = ms => new Promise(done => setTimeout(done, ms));
let child, socket;
try {
  for (const file of ['screen-studio.exe', 'ffmpeg/ffmpeg.exe', 'ffmpeg/ffprobe.exe', 'ffmpeg/LICENSE', 'ffmpeg/BUILD.txt'])
    assert(existsSync(join(destination, file)), `Distribution package missing ${file}`);
  assert(readdirSync(join(destination, 'studio-assets')).length >= 500, 'Visual assets must ship in the installer');
  const installerScript = readFileSync(join(destination, 'nsis/x64/installer.nsi'), 'utf8');
  for (const resource of ['ffmpeg.exe', 'ffprobe.exe', 'LICENSE', 'studio-assets', 'PortugueseBR', 'WriteUninstaller'])
    assert(installerScript.includes(resource), `Installer manifest missing ${resource}`);
  const checksum = createHash('sha256').update(readFileSync(installer)).digest('hex');
  assert(readFileSync(resolve(root, 'artifacts/windows/SHA256SUMS.txt'), 'utf8').startsWith(checksum));
  console.log('Distribution: installer manifest, SHA-256, optimized executable, FFmpeg/FFprobe, license and visual resources passed.');

  // Exercise the production binary and resources without changing Windows installation state.
  execFileSync(process.execPath, [resolve(root, 'tests/windows-native.test.mjs')], {
    cwd: root, windowsHide: true, stdio: 'inherit', timeout: 180000,
    env: { ...process.env, FRAME_TEST_APP: app, FRAME_TEST_ASSETS: join(destination, 'studio-assets') },
  });

  const listener = createServer();
  await new Promise(done => listener.listen(0, '127.0.0.1', done));
  const port = listener.address().port;
  await new Promise(done => listener.close(done));
  child = spawn(app, [], { windowsHide: true, stdio: 'ignore', env: {
    ...process.env,
    WEBVIEW2_USER_DATA_FOLDER: join(folder, 'webview-profile'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  } });
  let launchError;
  child.on('error', error => { launchError = error; });
  const deadline = Date.now() + 30000;
  let page;
  while (!page) {
    if (launchError) throw launchError;
    assert.equal(child.exitCode, null, 'Release application exited during startup');
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = targets.find(target => target.type === 'page');
    } catch { /* WebView2 is still starting. */ }
    if (Date.now() > deadline) throw new Error('Release WebView2 did not start');
    if (!page) await wait(100);
  }
  socket = new WebSocket(page.webSocketDebuggerUrl);
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
  let ui;
  while (!ui?.ready) {
    const result = await send('Runtime.evaluate', { returnByValue: true, expression: `({ ready: !!document.querySelector('.new-recording') && !!window.__TAURI_INTERNALS__, title: document.title, error: document.querySelector('.error-text')?.textContent || '', url: location.href })` });
    ui = result.result.value;
    if (Date.now() > deadline) throw new Error(`Release interface failed to load: ${JSON.stringify(ui)}`);
    if (!ui?.ready) await wait(100);
  }
  assert.equal(ui.error, '', JSON.stringify(ui));
  assert(!ui.url.includes(':1420'), 'Release app must load the bundled frontend without Vite');
  console.log('Release desktop: bundled frontend renders in real WebView2 with the native bridge and no development server.');
} finally {
  socket?.close();
  if (child && child.exitCode === null) {
    const closed = new Promise(done => child.once('close', done));
    child.kill();
    await closed;
  }
  assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
  rmSync(folder, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
