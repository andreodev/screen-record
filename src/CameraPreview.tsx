import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/window';
import type { RecordingDevices } from './recording-options';
import { DeviceSelect } from './DeviceSelect';
import './webcam.css';

type Snapshot = { frame: string | null; error: string | null; recording: boolean; deviceId: string };
export default function CameraPreview() {
  const [state, setState] = useState<Snapshot>({ frame: null, error: null, recording: false, deviceId: '' });
  const [cameras, setCameras] = useState<RecordingDevices['cameras']>([]);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    document.body.classList.add('floating-webcam-page');
    let disposed = false; const off: (() => void)[] = [];
    const register = async <T,>(name: string, change: (data: T) => void) => {
      const unlisten = await listen<T>(name, event => { if (!disposed) change(event.payload); });
      if (disposed) unlisten(); else off.push(unlisten);
    };
    void (async () => {
      await Promise.all([
        register<string>('camera-preview-frame', frame => setState(s => ({ ...s, frame, error: null }))),
        register<string>('camera-preview-error', error => setState(s => ({ ...s, error }))),
        register<boolean>('camera-preview-recording', recording => setState(s => ({ ...s, recording }))),
        register<string>('camera-preview-device', deviceId => setState(s => ({ ...s, deviceId }))),
        register('camera-preview-reset', () => setState(s => ({ ...s, frame: null, error: null }))),
      ]);
      const snapshot = await invoke<Snapshot>('camera_preview_snapshot');
      if (!disposed) setState(snapshot);
      const devices = await invoke<RecordingDevices>('list_recording_devices');
      if (!disposed) setCameras(devices.cameras);
    })().catch(cause => { if (!disposed) setState(s => ({ ...s, error: String(cause) })); });
    return () => { disposed = true; off.forEach(remove => remove()); };
  }, []);
  const action = async (command: string, args?: Record<string, unknown>) => {
    setPending(true);
    try { await invoke(command, args); }
    catch (cause) { setState(s => ({ ...s, error: String(cause) })); }
    finally { setPending(false); }
  };
  return <main className="floating-webcam" aria-label="Prévia flutuante da webcam">
    <header>
      <button className="floating-webcam-drag" aria-label="Mover prévia da webcam" title="Arraste para mover; use as setas no teclado"
        onPointerDown={event => { if (event.button === 0) void getCurrentWindow().startDragging(); }}
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault(); const key = event.key;
          void getCurrentWindow().outerPosition().then(p => getCurrentWindow().setPosition(new PhysicalPosition(p.x + (key === 'ArrowLeft' ? -10 : key === 'ArrowRight' ? 10 : 0), p.y + (key === 'ArrowUp' ? -10 : key === 'ArrowDown' ? 10 : 0))));
        }}><i className={state.recording ? 'recording' : ''} /> Webcam {state.recording ? '· gravando' : '· ao vivo'}</button>
      {!state.recording && <button aria-label="Desativar webcam" disabled={pending} onClick={() => void action('stop_camera_preview')}>×</button>}
    </header>
    <div className="floating-webcam-image">
      {state.frame ? <img src={`data:image/jpeg;base64,${state.frame}`} alt="Sua câmera ao vivo" draggable={false} /> : <span>◉</span>}
      {state.error && <div className="floating-webcam-error" role="alert"><p>{state.error}</p><button onClick={() => void action('open_camera_settings')}>Abrir permissão da câmera</button>{!state.recording && <button disabled={pending} onClick={() => void action('start_camera_preview', { deviceId: state.deviceId })}>Tentar novamente</button>}</div>}
    </div>
    <footer>
      {state.recording ? <button disabled={pending} onClick={() => void action('stop_operation')}>■ Parar gravação</button> : <DeviceSelect label="Webcam para gravar" value={state.deviceId} devices={cameras} disabled={pending} onChange={deviceId => void action('start_camera_preview', { deviceId: deviceId || '' })} />}
      <small>{state.error ? 'Câmera indisponível' : state.frame ? 'Prévia excluída da captura da tela' : 'Aguardando câmera…'}</small>
    </footer>
    <button className="floating-webcam-resize" aria-label="Redimensionar prévia da webcam" title="Arraste ou use as setas para redimensionar" onPointerDown={event => { if (event.button === 0) void getCurrentWindow().startResizeDragging('SouthEast'); }}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault(); const key = event.key;
        void getCurrentWindow().innerSize().then(s => getCurrentWindow().setSize(new PhysicalSize(s.width + (key === 'ArrowLeft' ? -10 : key === 'ArrowRight' ? 10 : 0), s.height + (key === 'ArrowUp' ? -10 : key === 'ArrowDown' ? 10 : 0))));
      }}>◢</button>
  </main>;
}
