(async () => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  const label = window.__TAURI_INTERNALS__.metadata.currentWindow.label;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const until = async check => { for (let i = 0; i < 200; i++) { if (await check()) return; await wait(100); } throw new Error('Floating preview timed out'); };
  const query = (command, args = {}) => invoke('plugin:window|' + command, { label, ...args });
  try {
    if (label === 'main') {
      const previous = localStorage.getItem('frame-studio-recording-options');
      await until(() => document.querySelector('button[title="Incluir webcam na próxima gravação"]'));
      await wait(500);
      document.querySelector('button[title="Incluir webcam na próxima gravação"]').click();
      await until(async () => (await invoke('plugin:window|get_all_windows')).includes('camera-preview'));
      assert(!document.querySelector('.camera-live-preview,.recording-camera-bubble'), 'Preview still belongs to main DOM');
      try { await until(async () => (await invoke('camera_preview_snapshot')).deviceId === 'synthetic-second-camera'); await wait(1500); }
      finally { if (previous === null) localStorage.removeItem('frame-studio-recording-options'); else localStorage.setItem('frame-studio-recording-options', previous); }
      for (let i = 0; i < 600 && !(await invoke('benchmark_config')).finish; i++) await wait(200);
      if ((await invoke('benchmark_config')).finish) {
        await invoke('stop_camera_preview');
        await until(async () => !(await invoke('plugin:window|get_all_windows')).includes('camera-preview'));
        const devices = await invoke('list_capture_sources');
        await invoke('start_recording', { withWebcam: false, withSystemAudio: false, withMicrophone: false, options: { source: { kind: 'area', id: devices.displays[0].id, area: { x: 150, y: 150, width: 600, height: 400 } }, resolution: 1080, fps: 30 } });
        await until(() => document.querySelector('.operation-overlay')?.textContent.includes('Gravando'));
        await invoke('report_preview_benchmark', { report: { phase: 'floating-recording-ready', passed: true, closedPreview: true, awaitingQuit: true } });
      }
      return;
    }
    await until(() => document.querySelector('.floating-webcam-drag'));
    assert(await query('is_always_on_top'), 'Window is not always on top');
    assert(!(await query('is_decorated')), 'Window has system borders');
    const initial = await query('outer_position');
    document.querySelector('.floating-webcam-drag').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await wait(300);
    const moved = await query('outer_position'); assert(moved.x === initial.x + 10, 'Keyboard drag failed');
    const size = await query('inner_size');
    document.querySelector('.floating-webcam-resize').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await wait(300); assert((await query('inner_size')).height === size.height + 10, 'Resize failed');
    await invoke('start_camera_preview', { deviceId: 'synthetic-second-camera' });
    await wait(800);
    assert((await invoke('camera_preview_snapshot')).deviceId === 'synthetic-second-camera', 'Device switch failed');
    await invoke('plugin:event|emit', { event: 'camera-preview-error', payload: 'Permissão da câmera negada — teste sintético' });
    await until(() => document.querySelector('[role="alert"]'));
    assert(document.querySelector('[role="alert"]').textContent.includes('Permissão'), 'Denied-permission UI missing');
    await invoke('plugin:event|emit', { event: 'camera-preview-reset', payload: null });
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const context = canvas.getContext('2d'); context.fillStyle = '#ff00ff'; context.fillRect(0, 0, 320, 240);
    await invoke('plugin:event|emit', { event: 'camera-preview-frame', payload: canvas.toDataURL('image/jpeg').split(',')[1] });
    await until(() => document.querySelector('.floating-webcam-image img')?.naturalWidth === 320);
    await invoke('report_preview_benchmark', { report: { phase: 'floating-ready', passed: true, alwaysOnTop: true, independent: true, keyboardMove: true, resize: true, devices: true, deniedPermissionUI: true, position: moved } });
  } catch (cause) { await invoke('report_preview_benchmark', { report: { phase: 'floating-preview', passed: false, error: String(cause), label } }); }
})();
