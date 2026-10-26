import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export type CaptureSource = { kind: 'display' | 'window'; id: number; label: string; width: number; height: number };
export type CaptureSelection = { source: { kind: 'display' | 'window' | 'area'; id: number; area?: { x: number; y: number; width: number; height: number } }; resolution: number; fps: number };

export function CaptureSettings({ close, start }: { close: () => void; start: (selection: CaptureSelection) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const [sources, setSources] = useState<{ displays: CaptureSource[]; windows: CaptureSource[] }>();
  const [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<'display' | 'window' | 'area'>('display');
  const [id, setId] = useState(0), [resolution, setResolution] = useState(2160), [fps, setFps] = useState(60);
  const [area, setArea] = useState({ x: 0, y: 0, width: 640, height: 480 });
  async function refresh() {
    setLoading(true); setError('');
    try { const value = await invoke<{ displays: CaptureSource[]; windows: CaptureSource[] }>('list_capture_sources'); setSources(value); setId(0); }
    catch (error) { setError(String(error)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  const choices = (kind === 'window' ? sources?.windows : sources?.displays) ?? [];
  const selected = choices.find(source => source.id === id) ?? choices[0];
  const valid = selected && (kind !== 'area' || Object.values(area).every(Number.isFinite) && area.x >= 0 && area.y >= 0 && area.width >= 32 && area.height >= 32 && area.x + area.width <= selected.width && area.y + area.height <= selected.height);
  return <dialog ref={dialog} className="capture-dialog" aria-labelledby="capture-title" onCancel={close}>
      <h2 id="capture-title">Nova gravação</h2>
      <label>Fonte<select autoFocus value={kind} onChange={event => { setKind(event.target.value as typeof kind); setId(0); }}>
        <option value="display">Monitor inteiro</option><option value="window">Janela</option><option value="area">Área do monitor</option>
      </select></label>
      <label>{kind === 'window' ? 'Janela' : 'Monitor'}<select disabled={loading || !choices.length} value={selected?.id ?? ''} onChange={event => setId(Number(event.target.value))}>
        {!choices.length && <option value="">{loading ? 'Carregando fontes…' : 'Nenhuma fonte disponível'}</option>}
        {choices.map(source => <option key={source.id} value={source.id}>{source.label}</option>)}
      </select></label>
      {kind === 'area' && <><p className="help">Coordenadas locais a partir do canto superior esquerdo do monitor. Monitor: {selected?.width} × {selected?.height}.</p><div className="capture-area-fields">
        {(['x', 'y', 'width', 'height'] as const).map((field, i) => <label key={field}>{['Esquerda', 'Topo', 'Largura', 'Altura'][i]}<input type="number" min={i < 2 ? 0 : 32} value={area[field]} onChange={event => setArea({ ...area, [field]: Number(event.target.value) })} /></label>)}
      </div></>}
      <div className="capture-area-fields"><label>Resolução máxima<select value={resolution} onChange={event => setResolution(Number(event.target.value))}><option value={1080}>1080p</option><option value={2160}>4K</option></select></label>
        <label>Quadros por segundo<select value={fps} onChange={event => setFps(Number(event.target.value))}><option value={30}>30 fps</option><option value={60}>60 fps</option></select></label></div>
      <p className="help">Webcam, microfone e áudio do sistema seguem as escolhas da barra de gravação.</p>
      {error && <><p role="alert">{error}</p><button onClick={() => void invoke("open_screen_recording_settings").catch(error => setError(String(error)))}>Abrir permissões de tela ↗</button></>}
      <div className="capture-actions"><button onClick={() => void refresh()} disabled={loading}>Atualizar fontes</button><button onClick={close}>Cancelar</button><button className="export-button" disabled={loading || !valid} onClick={() => { if (selected && valid) start({ source: { kind, id: selected.id, ...(kind === 'area' ? { area } : {}) }, resolution, fps }); }}>Iniciar gravação</button></div>
  </dialog>;
}
