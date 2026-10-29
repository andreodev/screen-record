import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') {
  console.log('Windows media integration: skipped on this platform.');
  process.exit(0);
}
const root = fileURLToPath(new URL('../', import.meta.url));
const app = process.env.FRAME_TEST_APP || resolve(root, 'src-tauri/target/debug/screen-studio.exe');
const ffmpeg = resolve(root, 'src-tauri/resources/ffmpeg/ffmpeg.exe');
const ffprobe = resolve(root, 'src-tauri/resources/ffmpeg/ffprobe.exe');
const assetsRoot = process.env.FRAME_TEST_ASSETS || resolve(root, 'src-tauri/resources/studio-assets');
const folder = mkdtempSync(join(tmpdir(), 'frame-windows-test-'));
const run = (...args) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { windowsHide: true, timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
const probe = path => JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', path], { windowsHide: true }));
const inspect = path => JSON.parse(execFileSync(app, ['--media-helper', 'inspect', path], { windowsHide: true, timeout: 15000 }).toString().trim());
function worker(args, onEvent = () => {}, timeout = 120000, env = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(app, ['--media-helper', ...args], { windowsHide: true, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let pending = '', errors = ''; const events = [];
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Worker timed out: ${args.join(' ')}\n${errors}`)); }, timeout);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      pending += chunk;
      while (pending.includes('\n')) {
        const at = pending.indexOf('\n'); const line = pending.slice(0, at); pending = pending.slice(at + 1);
        try { const value = JSON.parse(line); events.push(value); onEvent(value, child); } catch (error) { child.kill(); clearTimeout(timer); reject(error); }
      }
    });
    child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-8192); });
    child.on('close', code => { clearTimeout(timer); resolvePromise({ code, events, errors }); });
  });
}
const source = join(folder, 'source.mp4');
const face = join(folder, 'webcam.mp4');
const music = join(folder, 'music.wav');
const cursor = Array.from({ length: 120 }, (_, i) => ({ t: i / 30, x: .15 + .65 * i / 120, y: .5, down: i === 15 || i === 75, kind: i < 60 ? 'pointer' : 'hand' }));
function makeJob(destination, patch = {}) {
  return {
    source, destination, assetsRoot, start: 0, end: 4, resolution: 480, fps: 24,
    ranges: [{ start: 0, end: 1, speed: 2 }, { start: 2, end: 3, speed: .5 }],
    appearance: { background: 0, padding: 9, radius: 12, shadow: 35, aspect: '16:9', cursorSize: 24, cursorTheme: 'macos', motionBlur: { cursor: 0, zoom: 0, pan: 0 }, clickSounds: true, clickSoundVolume: .3 },
    keys: [{ t: 0, x: .5, y: .5, scale: 1 }, { t: 1, x: .5, y: .5, scale: 2 }, { t: 4, x: .5, y: .5, scale: 1 }],
    cursor, rawCursor: cursor, cursorCaptured: true,
    effects: [], webcam: null, backgroundAudio: null, microphone: null, sourceVolume: .7,
    ...patch,
  };
}
async function exportJob(job, event) {
  const path = join(folder, 'job.json'); writeFileSync(path, JSON.stringify(job));
  return worker(['export', path], event);
}
try {
  run('-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', source);
  run('-f', 'lavfi', '-i', 'color=c=lime:size=160x120:rate=30', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', face);
  run('-f', 'lavfi', '-i', 'sine=frequency=220:sample_rate=48000', '-t', '1', music);
  writeFileSync(join(folder, 'source.cursor.json'), JSON.stringify(cursor));
  const media = inspect(source).media;
  assert.equal(media.width, 320); assert.equal(media.height, 180); assert.equal(media.hasAudio, true); assert.equal(media.cursorCaptured, true); assert.equal(media.cursor.length, 120);
  const invalid = join(folder, 'invalid.mp4'); writeFileSync(invalid, 'invalid');
  assert.throws(() => inspect(invalid));
  console.log('Import: metadata, audio, cursor sidecar and invalid-media errors passed.');

  const output = join(folder, 'edited.mp4');
  let result = await exportJob(makeJob(output));
  assert.equal(result.code, 0, JSON.stringify(result));
  let info = probe(output); assert.equal(info.streams.find(s => s.codec_type === 'video').width, 854);
  assert.equal(info.streams.find(s => s.codec_type === 'video').height, 480);
  assert(info.streams.some(s => s.codec_type === 'audio')); assert(Math.abs(+info.format.duration - 2.5) < .12);
  assert(result.events.some(e => e.event === 'progress' && e.progress === 100)); assert(result.events.some(e => e.event === 'exported'));
  console.log('Export: cuts, 0.5x/2x speed, H.264/AAC, duration and progress passed.');

  const composite = join(folder, 'vertical.mp4');
  const job = makeJob(composite, {
    ranges: [{ start: 0, end: .5, speed: 1 }],
    webcam: { path: face, x: .75, y: .75, size: .3, shape: 'circle', mode: 'manual', keyframes: [{ t: 0, x: .75, y: .75, size: .3 }, { t: 1, x: .25, y: .25, size: .3 }], opacity: .9, border: 2 },
    backgroundAudio: { path: music, volume: .2 }, microphone: { path: music, volume: .2 },
    effects: [{ kind: 'highlight', start: 0, end: 1, x: .5, y: .5, width: .2, height: .2, opacity: .3 }, { kind: 'mask', start: 0, end: 1, x: .2, y: .2, width: .2, height: .2, opacity: 1 }],
  });
  job.appearance.aspect = '9:16'; job.appearance.backgroundMode = 'video-blur'; job.appearance.backgroundBlur = 2;
  job.appearance.motionBlur = { cursor: .25, zoom: .7, pan: .7 };
  result = await exportJob(job); assert.equal(result.code, 0, JSON.stringify(result));
  info = probe(composite); assert.equal(info.streams[0].width, 480); assert.equal(info.streams[0].height, 854); assert(info.streams.some(s => s.codec_type === 'audio'));
  // Actual pixels must contain the green webcam, rather than silently omit it.
  const pixels = run('-i', composite, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1');
  let green = 0; for (let i = 0; i < pixels.length; i += 3) if (pixels[i + 1] > 150 && pixels[i] < 60 && pixels[i + 2] < 60) green++;
  assert(green > 1000, `Webcam pixels missing: ${green}`);
  console.log('Composition: vertical, webcam pixels, masks, highlights, motion blur, music and microphone mix passed.');

  // The selected right half is blue; the excluded left half must never appear.
  const splitSource = join(folder, 'split.mp4');
  run('-f', 'lavfi', '-i', 'color=c=red:size=320x180:rate=24,drawbox=x=160:y=0:w=160:h=180:color=blue:t=fill', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', splitSource);
  const croppedOutput = join(folder, 'cropped.mp4');
  const croppedJob = makeJob(croppedOutput, {
    source: splitSource, start: 0, end: 1, ranges: [{ start: 0, end: .25, speed: 1 }],
    cursor: [], rawCursor: [], cursorCaptured: false,
    keys: [{ t: 0, x: .75, y: .5, scale: 1 }, { t: 1, x: .75, y: .5, scale: 1 }],
  });
  Object.assign(croppedJob.appearance, { aspect: 'auto', padding: 0, radius: 0, shadow: 0, crop: { x: .5, y: 0, width: .5, height: 1 } });
  result = await exportJob(croppedJob); assert.equal(result.code, 0, JSON.stringify(result));
  info = probe(croppedOutput);
  assert.equal(info.streams[0].width, 480); assert.equal(info.streams[0].height, 540);
  const croppedPixels = run('-i', croppedOutput, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1');
  let red = 0, blue = 0;
  for (let i = 0; i < croppedPixels.length; i += 3) {
    if (croppedPixels[i] > 150 && croppedPixels[i + 2] < 60) red++;
    if (croppedPixels[i + 2] > 150 && croppedPixels[i] < 60) blue++;
  }
  assert.equal(red, 0, 'Excluded source pixels leaked into the crop');
  assert(blue > 480 * 540 * .98, `Selected source pixels missing: ${blue}`);
  console.log('Crop export: off-center selection, output aspect and selected/excluded pixels passed.');

  const sentinel = join(folder, 'cancelled.mp4'); writeFileSync(sentinel, 'preserve-existing-destination');
  result = await exportJob(makeJob(sentinel), (event, child) => { if (event.event === 'progress') child.stdin.end('stop\n'); });
  assert.notEqual(result.code, 0); assert(result.events.some(e => e.event === 'error' && /cancelada/i.test(e.message)));
  assert.equal(readFileSync(sentinel, 'utf8'), 'preserve-existing-destination');
  assert(!readdirSync(folder).some(s => s.startsWith('.frame-windows-')));
  assert.equal(inspect(source).media.duration, media.duration);
  console.log('Cancellation: existing output, source preservation and temporary cleanup passed.');

  if (process.argv.includes('--desktop')) {
    const project = join(folder, 'smoke.frame.json');
    writeFileSync(project, JSON.stringify({ version: 1, name: 'Teste Windows', mediaPath: source, zooms: [], appearance: { ...makeJob(output).appearance, smooth: true }, trim: { start: 0, end: 4 } }));
    const report = join(folder, 'desktop-report.jsonl'); const config = join(folder, 'desktop-config.json');
    writeFileSync(config, JSON.stringify({ project, report, seconds: 1, idleSeconds: 1, checkCursor: true }));
    const child = spawn(app, [], { windowsHide: true, env: { ...process.env, FRAME_STUDIO_BENCHMARK: config }, stdio: 'ignore' });
    const closed = new Promise(resolveClose => child.once('close', resolveClose));
    try {
      const deadline = Date.now() + 45000;
      let reports = [];
      while (Date.now() < deadline) {
        await new Promise(resolveWait => setTimeout(resolveWait, 200));
        if (existsSync(report)) reports = readFileSync(report, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        assert(!reports.some(r => r.phase === 'error'), JSON.stringify(reports));
        if (reports.some(r => r.phase === 'paused-after-playback')) break;
      }
      assert(reports.some(r => r.phase === 'playback' && r.videoTime > 0 && r.decodedFrames > 0), JSON.stringify(reports));
      assert(reports.some(r => r.phase === 'cursor-visible' && r.passed && r.width > 0), JSON.stringify(reports));
      console.log('Desktop: real WebView2 project open, cursor image decode/visibility, video decode and playback passed.');
    } finally { child.kill(); await closed; }
  }

  if (process.argv.includes('--capture')) {
    const devices = JSON.parse(execFileSync(app, ['--media-helper', 'devices'], { windowsHide: true, timeout: 15000 }).toString().trim());
    assert(devices.outputs.length > 0); assert(devices.inputs.length > 0); assert(devices.cameras.length > 0);
    for (const list of [devices.outputs, devices.inputs, devices.cameras]) { assert.equal(new Set(list.map(d => d.id)).size, list.length); assert(list.every(d => d.label && d.id)); }
    const options = { outputDevice: (devices.outputs.find(d => d.isDefault) || devices.outputs[0]).id, microphoneDevice: (devices.inputs.find(d => d.isDefault) || devices.inputs[0]).id, cameraDevice: devices.cameras[0].id };
    console.log(`Devices: ${devices.outputs.length} outputs, ${devices.inputs.length} microphones, ${devices.cameras.length} cameras; stable IDs passed.`);
    let previewTimer;
    result = await worker(['camera-preview', options.cameraDevice], (event, child) => { if (event.event === 'camera-frame' && !previewTimer) { assert(Buffer.from(event.data, 'base64').subarray(0, 2).equals(Buffer.from([255, 216]))); previewTimer = setTimeout(() => child.stdin.end('stop\n'), 200); } }, 30000);
    assert.equal(result.code, 0, JSON.stringify(result)); assert(result.events.some(e => e.event === 'camera-frame'));
    console.log('Hardware: actual webcam preview passed.');
    const recording = join(folder, 'recording.mov'); const camera = join(folder, 'camera.mov');
    let stopTimer;
    result = await worker(['record', recording, camera, '--system-audio', '--microphone'], (event, child) => { if (event.event === 'started') stopTimer = setTimeout(() => child.stdin.end('stop\n'), 2500); }, 45000, { FRAME_CAPTURE_OPTIONS: JSON.stringify(options) });
    clearTimeout(stopTimer); assert.equal(result.code, 0, JSON.stringify(result));
    const captured = inspect(recording).media;
    assert(captured.duration >= 2); assert(captured.cursorCaptured); assert(captured.cursor.length > 100); assert(captured.hasAudio);
    assert(existsSync(camera)); assert(existsSync(join(folder, 'recording.microphone.m4a')));
    assert(result.events.some(e => e.event === 'recording-time' && e.seconds > 0));
    assert(result.events.some(e => e.event === 'camera-frame'), 'Missing live webcam during recording');
    console.log(`Hardware: desktop + cursor + system audio + microphone + webcam passed (${captured.duration.toFixed(2)} s, ${captured.cursor.length} cursor samples).`);
  }
} finally {
  rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
