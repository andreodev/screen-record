import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { autoZooms, backgrounds, cameraFromKeys, cameraKeys, clamp, cursorAt, defaults, smoothCursor, type Appearance, type CursorEvent, type Zoom } from "./zoom";
import "./App.css";
import assetCatalog from "./studio-assets.json";

type Media = { path: string; duration: number; width: number; height: number; cursor: CursorEvent[]; cursorCaptured: boolean };
type Project = { version: 1 | 2; name: string; mediaPath: string; zooms: Zoom[]; trim: { start: number; end: number }; appearance: Appearance };
type Operation = "idle" | "opening" | "saving" | "starting" | "recording" | "stopping" | "exporting";
type Panel = "background" | "zoom" | "cursor" | "animations";
const clock = (time: number) => `${Math.floor(time / 60)}:${(Math.max(0, time) % 60).toFixed(2).padStart(5, "0")}`;
function storedAppearance(): Appearance {
  try { const value = JSON.parse(localStorage.getItem("frame-preset") || "null"); return value && typeof value.padding === "number" ? { ...defaults, ...value } : defaults; } catch { return defaults; }
}
function AppIcon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    folder: <path d="M3 7V5h7l2 3h9v12H3V7h18" />,
    zoom: <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6M7 10h6M10 7v6" /></>,
    cursor: <path d="m5 2 14 12-7 1 4 7-3 1-4-7-4 5Z" />,
    background: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="m3 17 6-7 5 5 3-3 4 5" /></>,
    play: <><circle cx="12" cy="12" r="9" /><path d="m10 8 6 4-6 4Z" /></>,
    pause: <><path d="M9 7v10M15 7v10" /></>,
    export: <><path d="M12 16V2m-4 4 4-4 4 4M5 11H3v11h18V11h-2" /></>,
    record: <><rect x="2" y="3" width="20" height="15" rx="3" /><path d="M8 22h8M12 18v4" /></>,
    save: <><path d="M3 3h15l3 3v15H3ZM7 3v7h10V3M7 21v-7h10v7" /></>,
    animations: <><path d="M3 17c3-15 6 15 10 0s5 0 8-10" /><path d="m17 6 4 1-1 4" /></>,
    settings: <><path d="M3 6h18M3 12h18M3 18h18" /><circle cx="8" cy="6" r="2" /><circle cx="16" cy="12" r="2" /><circle cx="9" cy="18" r="2" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.settings}</svg>;
}
function Range({ label, value, min, max, step = 1, suffix = "", onChange }: { label: string; value: number; min: number; max: number; step?: number; suffix?: string; onChange: (n: number) => void }) {
  return <label className="range-field"><span>{label}<output>{Number(value.toFixed(2))}{suffix}</output></span><input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} /></label>;
}
export default function App() {
  const [media, setMedia] = useState<Media | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [past, setPast] = useState<Project[]>([]), [future, setFuture] = useState<Project[]>([]);
  const histories = useRef<{ past: Project[]; future: Project[] }>({ past: [], future: [] });
  const [panel, setPanel] = useState<Panel>("background");
  const [selected, setSelected] = useState<string | null>(null);
  const [operation, setOperation] = useState<Operation>("idle");
  const [notice, setNotice] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const pendingSeek = useRef(0);
  const [error, setError] = useState("");
  const [time, setTime] = useState(0), [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0), [elapsed, setElapsed] = useState(0);
  const [size, setSize] = useState({ width: 700, height: 400 });
  const [rate, setRate] = useState(1);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [assetRoot, setAssetRoot] = useState("");
  const [wallpaperGroup, setWallpaperGroup] = useState("macOS");
  const [cursorGroup, setCursorGroup] = useState("macos");
  const video = useRef<HTMLVideoElement>(null), plane = useRef<HTMLDivElement>(null), cursor = useRef<HTMLDivElement>(null);
  const scene = useRef<HTMLDivElement>(null), inspector = useRef<HTMLElement>(null);
  useEffect(() => { if (inspector.current) inspector.current.scrollTop = 0; }, [panel]);
  const projectRef = useRef(project); projectRef.current = project;
  const mediaRef = useRef(media); mediaRef.current = media;
  const operationRef = useRef(operation); operationRef.current = operation;
  const viewportRef = useRef({ width: 700, height: 400 });
  const desktop = isTauri(), busy = operation !== "idle";
  const look = project?.appearance || defaults;
  const currentZoom = project?.zooms.find(z => z.id === selected);
  const cursorMotion = look.cursorMotion || ((look.cursorSmooth ?? look.smooth) ? "medium" : "original");
  const smoothEvents = useMemo(() => smoothCursor(media?.cursor || [], cursorMotion === "smooth" ? .1 : cursorMotion === "rapid" ? .035 : .065), [media, cursorMotion]);
  const cursorSmooth = cursorMotion !== "original";
  const events = cursorSmooth ? smoothEvents : media?.cursor || [];
  const trajectory = useMemo(() => media && project ? cameraKeys(project.zooms, media.duration, look.smooth, events, look.cameraSpring) : [], [project?.zooms, media, look.smooth, look.cameraSpring, cursorSmooth, smoothEvents]);
  const selectedCursor = assetCatalog.cursors.find(item => item.id === look.cursorAsset);
  const selectedWallpaper = assetCatalog.wallpapers.find(item => item.id === look.wallpaper);
  const assetURL = (file: string) => assetRoot ? convertFileSrc(`${assetRoot}/${file}`) : undefined;
  useEffect(() => {
    if (desktop) void invoke<string>("studio_asset_root").then(setAssetRoot).catch(e => setError(String(e)));
  }, [desktop]);
  const renderData = useRef({ trajectory, events }); renderData.current = { trajectory, events };

  const edit = useCallback((update: (p: Project) => Project) => {
    const p = projectRef.current; if (!p || operationRef.current !== "idle") return;
    histories.current = { past: [...histories.current.past.slice(-49), p], future: [] };
    setPast(histories.current.past); setFuture([]);
    const next = update(p); projectRef.current = next; setProject(next);
  }, []);
  const undo = useCallback(() => {
    if (operationRef.current !== "idle" || !projectRef.current) return;
    const h = histories.current, previous = h.past[h.past.length - 1]; if (!previous) return;
    histories.current = { past: h.past.slice(0, -1), future: [projectRef.current, ...h.future] };
    setPast(histories.current.past); setFuture(histories.current.future); setProject(previous); projectRef.current = previous;
  }, []);
  const redo = useCallback(() => {
    if (operationRef.current !== "idle" || !projectRef.current) return;
    const h = histories.current, next = h.future[0]; if (!next) return;
    histories.current = { past: [...h.past, projectRef.current], future: h.future.slice(1) };
    setPast(histories.current.past); setFuture(histories.current.future); setProject(next); projectRef.current = next;
  }, []);
  const load = useCallback((m: Media, document?: Project, documentPath?: string) => {
    video.current?.pause(); setPlaying(false); setMedia(m);
    const p: Project = document || { version: 1, mediaPath: m.path, name: m.path.split("/").pop() || "Novo take", zooms: autoZooms(m.cursor, m.duration), trim: { start: 0, end: m.duration }, appearance: storedAppearance() };
    const packageEnd = m.path.lastIndexOf(".framestudio/");
    setProjectPath(documentPath?.endsWith(".framestudio") ? documentPath : packageEnd >= 0 ? m.path.slice(0, packageEnd + ".framestudio".length) : "");
    pendingSeek.current = p.trim.start;
    setWallpaperGroup(assetCatalog.wallpapers.find(item=>item.id===p.appearance.wallpaper)?.group || "macOS");
    setCursorGroup(assetCatalog.cursors.find(item=>item.id===p.appearance.cursorAsset)?.group || "macos");
    setProject(p); projectRef.current = p; setPast([]); setFuture([]); histories.current = { past: [], future: [] }; setSelected(null); setTime(p.trim.start); setOperation("idle"); setError("");
    setNotice(m.cursorCaptured ? `${p.zooms.length} zooms sugeridos pelos cliques. Você pode ajustar cada trecho.` : "Vídeo importado. Adicione zooms na faixa roxa; este arquivo não tem eventos de cursor.");
  }, []);
  useEffect(() => {
    if (!desktop) return;
    let disposed = false; const cleanups: (() => void)[] = [];
    const register = async <T,>(name: string, handler: (data: T) => void) => { const off = await listen<T>(name, e => { if (!disposed) handler(e.payload); }); if (disposed) off(); else cleanups.push(off); };
    void register("recording-started", () => { setOperation("recording"); setElapsed(0); });
    void register<Media>("recording-finished", m => load(m));
    void register<{ progress: number }>("export-progress", e => setProgress(e.progress));
    void register<{ path: string }>("export-finished", e => { setOperation("idle"); setNotice(`Exportação concluída: ${e.path}`); setProgress(100); });
    void register("project-open-request", () => {
      if (operationRef.current !== "idle") return;
      void invoke<{ media: Media; project: Project; path: string } | null>("take_pending_project").then(result => { if (result) load(result.media, result.project, result.path); }).catch(e => setError(String(e)));
    });
    void register<string>("operation-error", message => { setOperation("idle"); setError(message); });
    return () => { disposed = true; cleanups.forEach(off => off()); };
  }, [desktop, load]);
  useEffect(() => {
    if (operation !== "recording") return;
    const start = performance.now(); const timer = window.setInterval(() => setElapsed((performance.now() - start) / 1000), 200);
    return () => clearInterval(timer);
  }, [operation]);
  useEffect(() => {
    const element = scene.current; if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height })); observer.observe(element);
    return () => observer.disconnect();
  }, [media, look.aspect]);
  const padding = Math.min(size.width, size.height) * look.padding / 100;
  const sourceAspect = media ? media.width / media.height : 16 / 10;
  const sceneAspect = look.aspect === "auto" ? sourceAspect : look.aspect === "16:9" ? 16 / 9 : look.aspect === "9:16" ? 9 / 16 : 1;
  const vw = Math.min(size.width - padding * 2, (size.height - padding * 2) * sourceAspect), vh = vw / sourceAspect;
  viewportRef.current = { width: vw, height: vh };
  const draw = useCallback((t: number) => {
    const p = projectRef.current, m = mediaRef.current; if (!p || !m) return;
    const cam = cameraFromKeys(t, renderData.current.trajectory), view = viewportRef.current;
    if (plane.current) plane.current.style.transform = `translate(${(.5 - cam.x) * view.width * cam.scale}px, ${(.5 - cam.y) * view.height * cam.scale}px) scale(${cam.scale})`;
    const point = cursorAt(t, renderData.current.events);
    if (cursor.current && point) { cursor.current.style.transform = `translate(${point.x * view.width}px, ${point.y * view.height}px)`; }
  }, []);
  useEffect(() => { draw(video.current?.currentTime || time); }, [project, size, time, draw]);
  useEffect(() => {
    const element = video.current; if (!element || !playing) return;
    let frame = 0, lastUpdate = 0, active = true;
    if (plane.current) plane.current.style.willChange = "transform";
    const tick = () => {
      if (!active) return;
      const p = projectRef.current;
      if (p && element.currentTime >= p.trim.end) { element.pause(); element.currentTime = p.trim.start; setTime(p.trim.start); setPlaying(false); return; }
      draw(element.currentTime);
      if (performance.now() - lastUpdate > 250) { setTime(element.currentTime); lastUpdate = performance.now(); }
      // Camera/cursor still animate over a held video frame from an idle screen.
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => { active = false; cancelAnimationFrame(frame); if (plane.current) plane.current.style.willChange = ""; };
  }, [playing, draw]);
  const seek = useCallback((t: number) => {
    const p = projectRef.current; if (!p) return;
    const next = clamp(t, p.trim.start, p.trim.end); if (video.current) video.current.currentTime = next; setTime(next); draw(next);
  }, [draw]);
  const togglePlay = useCallback(async () => {
    const element = video.current, p = projectRef.current; if (!element || !p || operationRef.current !== "idle") return;
    if (element.paused) { if (element.currentTime < p.trim.start || element.currentTime >= p.trim.end - .02) element.currentTime = p.trim.start; try { await element.play(); } catch (e) { setError(String(e)); } } else element.pause();
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement; if (["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) || target.isContentEditable) return;
      if (e.code === "Space") { e.preventDefault(); void togglePlay(); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      if (e.key === "ArrowRight") { e.preventDefault(); seek((video.current?.currentTime || 0) + 1 / 30); }
      if (e.key === "ArrowLeft") { e.preventDefault(); seek((video.current?.currentTime || 0) - 1 / 30); }
    }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, [togglePlay, redo, undo, seek]);
  async function action<T>(name: string, args?: Record<string, unknown>): Promise<T | undefined> {
    setError(""); try { return await invoke<T>(name, args); } catch (e) { setError(String(e)); setOperation("idle"); }
  }
  async function importVideo() { video.current?.pause(); setOperation("opening"); const m = await action<Media | null>("import_video"); if (m) load(m); else setOperation("idle"); }
  async function openProject() { video.current?.pause(); setOperation("opening"); const result = await action<{ media: Media; project: Project; path: string } | null>("open_project"); if (result) load(result.media, result.project, result.path); else setOperation("idle"); }
  async function saveProject(saveAs = false) {
    if (!project) return; video.current?.pause(); setOperation("saving");
    const result = await action<{ path: string; media: Media } | null>("save_project", { project, saveAs });
    setOperation("idle");
    if (result) {
      pendingSeek.current = time;
      const rewrite = (p: Project): Project => ({ ...p, version: 2, mediaPath: result.media.path });
      const next = rewrite(projectRef.current!); setProject(next); projectRef.current = next;
      histories.current = { past: histories.current.past.map(rewrite), future: histories.current.future.map(rewrite) };
      setPast(histories.current.past); setFuture(histories.current.future); setMedia(result.media); setProjectPath(result.path);
      setNotice(`Projeto salvo com mídia incluída: ${result.path}`);
    }
  }
  async function record() { video.current?.pause(); setOperation("starting"); setNotice("Aguardando os primeiros frames. Se solicitado, autorize a gravação de tela no macOS."); await action("start_recording"); }
  async function stop() { const previous = operation; setOperation(previous === "exporting" ? "exporting" : "stopping"); const ok = await action("stop_operation"); if (ok === undefined && operationRef.current === "idle") return; }
  async function exportVideo() { if (!project || !media) return; video.current?.pause(); setOperation("exporting"); setProgress(0); const started = await action<boolean>("export_video", { settings: { start: project.trim.start, end: project.trim.end, appearance: project.appearance, keys: trajectory, cursor: events } }); if (!started) setOperation("idle"); }
  function appearance(patch: Partial<Appearance>) { edit(p => ({ ...p, appearance: { ...p.appearance, ...(patch.smooth !== undefined ? { cursorSmooth: p.appearance.cursorSmooth ?? p.appearance.smooth } : {}), ...patch } })); }
  function zoomChange(patch: Partial<Zoom>) { edit(p => ({ ...p, zooms: p.zooms.map(z => z.id === selected ? { ...z, ...patch } : z) })); }
  function addZoom(t = time) {
    if (!project || !media || busy) return;
    const start = clamp(t, 0, Math.max(0, media.duration - .2)), end = Math.min(media.duration, start + 2.4), point = cursorAt(t, media.cursor);
    const z: Zoom = { id: crypto.randomUUID(), start, end, scale: 1.65, x: point?.x ?? .5, y: point?.y ?? .5, enabled: true };
    edit(p => ({ ...p, zooms: [...p.zooms, z] })); setSelected(z.id); setPanel("zoom"); seek(Math.min(end, start + .7));
  }
  useEffect(() => {
    if (!desktop || operation !== "idle") return;
    void invoke<{ media: Media; project: Project; path: string } | null>("take_pending_project").then(result => { if (result) load(result.media, result.project, result.path); }).catch(e => setError(String(e)));
  }, [desktop, operation, load]);
  useEffect(() => {
    if (!desktop || !project || !projectPath || busy) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void invoke<string | null>("autosave_project", { project }).then(path => { if (active && path) setNotice(`Salvo automaticamente · ${path.split("/").pop()}`); }).catch(e => { if (active) setError(`Não foi possível salvar automaticamente: ${String(e)}`); });
    }, 700);
    return () => { active = false; clearTimeout(timer); };
  }, [desktop, project, projectPath, busy]);
  function dragZoom(event: React.PointerEvent<HTMLButtonElement>, zoom: Zoom) {
    if (event.button !== 0 || busy || !media || !project) return;
    const rect = event.currentTarget.getBoundingClientRect(), track = event.currentTarget.parentElement!.getBoundingClientRect();
    const mode = event.clientX - rect.left < 8 ? "start" : rect.right - event.clientX < 8 ? "end" : "move";
    const startX = event.clientX, original = project; let moved = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      if (Math.abs(e.clientX - startX) < 2 && !moved) return;
      if (!moved) { histories.current = { past: [...histories.current.past.slice(-49), original], future: [] }; setPast(histories.current.past); setFuture([]); moved = true; }
      const delta = (e.clientX - startX) / track.width * media.duration;
      const patch = mode === "start" ? { start: clamp(zoom.start + delta, 0, zoom.end - .1) } : mode === "end" ? { end: clamp(zoom.end + delta, zoom.start + .1, media.duration) } : (() => { const start = clamp(zoom.start + delta, 0, media.duration - (zoom.end - zoom.start)); return { start, end: start + zoom.end - zoom.start }; })();
      const next = { ...original, zooms: original.zooms.map(z => z.id === zoom.id ? { ...z, ...patch } : z) };
      projectRef.current = next; setProject(next); setSelected(zoom.id); setPanel("zoom");
    };
    const end = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); window.removeEventListener("pointercancel", end); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end); window.addEventListener("pointercancel", end);
  }
  const palette = look.colors || backgrounds[clamp(look.background, 0, backgrounds.length - 1)];
  const backgroundStyle = look.backgroundMode === "wallpaper" && selectedWallpaper && assetRoot ? `url("${assetURL(selectedWallpaper.file)}") center / cover` : look.backgroundMode === "color" ? palette[0] : `linear-gradient(135deg, ${palette[0]}, ${palette[1]})`;
  return <main className="editor">
    <header className="editor-header"><div className="header-left"><span className="brand-mark">▰</span><strong>Frame Studio</strong><button onClick={() => void importVideo()} disabled={!desktop || busy} title="Importar vídeo" aria-label="Importar vídeo"><AppIcon name="folder" /></button><button onClick={() => void openProject()} disabled={!desktop || busy}>Abrir projeto</button></div><span className="project-name">{project?.name || "Novo projeto"}<small>{projectPath ? ".framestudio · salvo no Mac" : project ? "· ainda não salvo" : "Local · macOS"}</small></span><div className="header-actions"><button disabled={!past.length || busy} onClick={undo} title="Desfazer ⌘Z" aria-label="Desfazer">↶</button><button disabled={!future.length || busy} onClick={redo} title="Refazer ⇧⌘Z" aria-label="Refazer">↷</button><span className="divider" /><div className="preset-control"><button disabled={!project || busy} aria-expanded={presetsOpen} onClick={() => setPresetsOpen(!presetsOpen)}><AppIcon name="settings" />Presets⌄</button>{presetsOpen && <><button className="menu-dismiss" aria-label="Fechar presets" onClick={() => setPresetsOpen(false)} /><div className="preset-menu">{([{name:"Estúdio",description:"Violeta · movimento suave",value:{...defaults,cursorSmooth:true}}, {name:"Foco",description:"Grafite · enquadramento próximo",value:{...defaults,background:4,padding:4,radius:8,shadow:25,smooth:false,cursorSmooth:true}}, {name:"Cinema",description:"Oceano · 16:9 · margem ampla",value:{...defaults,background:1,padding:14,radius:18,shadow:55,aspect:"16:9",cursorSmooth:true}}]).map(preset => <button key={preset.name} onClick={() => { appearance({...preset.value,colors:undefined,backgroundMode:"gradient",wallpaper:undefined,cursorAsset:undefined,cursorMotion:undefined,cameraSpring:false,backgroundBlur:0}); setPresetsOpen(false); }}><strong>{preset.name}</strong><small>{preset.description}</small></button>)}<button onClick={() => { appearance(storedAppearance());setPresetsOpen(false); }}>Meu padrão salvo</button></div></>}</div><button disabled={!project || busy} onClick={() => void saveProject(true)} title="Criar uma cópia independente do projeto">Salvar como</button><button disabled={!project || busy} onClick={() => void saveProject()}><AppIcon name="save" />Salvar</button><button className="export-button" disabled={!project || busy} onClick={() => void exportVideo()}><AppIcon name="export" />Exportar</button></div></header>
    <div className="editor-body">
      <section className="preview-column">
        <div className="preview-toolbar"><label><AppIcon name="record" /><select aria-label="Proporção do vídeo" value={look.aspect} disabled={!project || busy} onChange={e => appearance({ aspect: e.target.value })}><option value="auto">Auto</option><option>16:9</option><option>9:16</option><option>1:1</option></select></label><span className="preview-quality">Prévia <b>Original</b></span><button className="new-recording" disabled={!desktop || busy} onClick={() => void record()}><span className="red-dot" />Nova gravação</button></div>
        <div className="preview-area">
          <div ref={scene} className="scene" style={{ "--scene-ratio": sceneAspect, aspectRatio: sceneAspect, maxHeight: "100%" } as React.CSSProperties}>
            <div className="scene-background" style={{background:backgroundStyle,filter: `blur(${(look.backgroundBlur || 0) * size.width / 1920}px)`}} />
            {media ? <div className="video-viewport" style={{ width: vw, height: vh, left: (size.width - vw) / 2, top: (size.height - vh) / 2, borderRadius: look.radius * size.width / 1000, boxShadow: `0 ${12 * size.width / 1920}px ${36 * size.width / 1920}px rgba(0,0,0,${look.shadow / 100})` }} onClick={e => {
              if (panel !== "zoom" || !currentZoom || busy) return;
              const rect = e.currentTarget.getBoundingClientRect(), cam = cameraFromKeys(time, trajectory);
              zoomChange({ x: clamp(cam.x + ((e.clientX - rect.left) / rect.width - .5) / cam.scale, 0, 1), y: clamp(cam.y + ((e.clientY - rect.top) / rect.height - .5) / cam.scale, 0, 1), follow: false });
            }}><div className="media-plane" ref={plane}><video ref={video} src={convertFileSrc(media.path)} playsInline preload="metadata" onLoadedMetadata={() => { if (video.current) video.current.playbackRate = rate; seek(pendingSeek.current); }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onSeeked={() => draw(video.current?.currentTime || 0)} onError={() => setError("Não foi possível reproduzir este codec. Tente um vídeo H.264 em MOV ou MP4.")} /><div className="rendered-cursor" ref={cursor} style={{display:media.cursorCaptured && look.cursorSize > 0 ? "block" : "none",width:look.cursorSize * size.width / 1000 * (selectedCursor ? 1.2 * selectedCursor.width / selectedCursor.height : .8),height:look.cursorSize * size.width / 1000 * 1.2}}>{selectedCursor ? <img src={assetURL(selectedCursor.file)} alt="" style={{transform:`translate(${-selectedCursor.hotspotX * 100}%,${-selectedCursor.hotspotY * 100}%)`}} /> : <svg viewBox="-1 -1 20 30" aria-hidden="true"><path d="M0 0V23L6 17L10 26L14 24L10 15H18Z" fill="white" stroke="#151518" strokeWidth="1.3" /></svg>}</div></div></div> : <div className="empty-preview"><div className="empty-icon"><AppIcon name="record" /></div><h1>Seu próximo vídeo começa aqui.</h1><p>Grave sua tela ou abra um vídeo.<br />Dê foco ao que importa, com zooms suaves.</p><button className="light-button" disabled={!desktop || busy} onClick={() => void importVideo()}><AppIcon name="folder" />Importar vídeo</button><span>Processamento local · sem upload</span></div>}
          </div>
          {operation === "recording" || operation === "starting" || operation === "stopping" ? <div className="operation-overlay"><span className="red-dot" /><strong>{operation === "recording" ? "Gravando o monitor principal" : operation === "starting" ? "Preparando captura…" : "Finalizando vídeo…"}</strong><span className="record-clock">{clock(elapsed)}</span><p>A tela inteira será gravada sem áudio.</p><button className="light-button" disabled={operation === "stopping"} onClick={() => void stop()}>■ Parar gravação</button></div> : null}
        </div>
        <div className="transport"><span className="timecode">{clock(time)}</span><button disabled={!media || busy} onClick={() => seek(project?.trim.start || 0)} aria-label="Voltar ao início">|◁</button><button className="play-button" disabled={!media || busy} onClick={() => void togglePlay()} aria-label={playing ? "Pausar" : "Reproduzir"}><AppIcon name={playing ? "pause" : "play"} /></button><button disabled={!media || busy} onClick={() => seek(project?.trim.end || 0)} aria-label="Ir ao fim">▷|</button><span className="timecode">{clock(project?.trim.end || 0)}</span><select className="speed" aria-label="Velocidade da prévia" value={rate} onChange={e => { const r = Number(e.target.value); setRate(r); if (video.current) video.current.playbackRate = r; }}><option value={.5}>0.5×</option><option value={1}>1×</option><option value={1.5}>1.5×</option><option value={2}>2×</option></select></div>
      </section>
      <nav className="inspector-tabs" aria-label="Ferramentas do editor">{([['background', 'Aparência'], ['zoom', 'Zooms'], ['cursor', 'Cursor'], ['animations', 'Animações']] as const).map(([key, label]) => <button key={key} className={panel === key ? "active" : ""} onClick={() => setPanel(key)} title={label} aria-label={label} aria-pressed={panel === key}><AppIcon name={key} /></button>)}</nav>
      <aside className="inspector" ref={inspector}><fieldset disabled={!project || busy}>
        {panel === "background" && <><div className="panel-title"><h2>Background</h2><span>Fundo e enquadramento</span></div><h3>Fundo</h3><div className="segmented" role="group" aria-label="Tipo de fundo"><button className={look.backgroundMode === "wallpaper" ? "active" : ""} onClick={() => appearance({backgroundMode:"wallpaper",wallpaper:look.wallpaper || assetCatalog.wallpapers.find(item=>item.group === "macOS")!.id})}>Wallpaper</button><button className={!look.backgroundMode || look.backgroundMode === "gradient" ? "active" : ""} onClick={() => appearance({backgroundMode:"gradient"})}>Gradiente</button><button className={look.backgroundMode === "color" ? "active" : ""} onClick={() => appearance({backgroundMode:"color"})}>Cor</button></div>{look.backgroundMode === "wallpaper" ? <><select className="asset-group" aria-label="Coleção de wallpapers" value={wallpaperGroup} onChange={e => setWallpaperGroup(e.target.value)}>{[...new Set(assetCatalog.wallpapers.map(item=>item.group))].map(group=><option key={group}>{group}</option>)}</select><button className="wide subtle random-background" disabled={!assetRoot} onClick={() => { const items=assetCatalog.wallpapers.filter(item=>item.group===wallpaperGroup && item.id!==look.wallpaper); appearance({wallpaper:items[Math.floor(Math.random()*items.length)].id}); }}>✧ Escolher wallpaper aleatório</button><div className="asset-grid wallpaper-grid">{assetRoot && assetCatalog.wallpapers.filter(item=>item.group===wallpaperGroup).map(item=><button key={item.id} className={look.wallpaper===item.id?"selected":""} title={item.label} aria-label={item.label} aria-pressed={look.wallpaper===item.id} onClick={()=>appearance({wallpaper:item.id})}><img loading="lazy" src={assetURL(item.thumb)} alt="" /></button>)}</div></> : <><button className="wide subtle random-background" onClick={() => { const next = (look.background + 1 + Math.floor(Math.random() * (backgrounds.length - 1))) % backgrounds.length; appearance({background:next,colors:undefined}); }}>✧ Escolher fundo aleatório</button><div className="swatches">{backgrounds.map((colors, i) => <button key={i} className={!look.colors && look.background === i ? "selected" : ""} style={{ background: `linear-gradient(135deg,${colors[0]},${colors[1]})` }} aria-label={`Gradiente ${i + 1}`} aria-pressed={look.background === i} onClick={() => appearance({ background: i, colors: undefined })} />)}</div><div className="color-fields"><label><input aria-label="Cor principal do fundo" type="color" value={palette[0]} onChange={e => appearance({colors:[e.target.value,palette[1]]})} /><span>{palette[0].toUpperCase()}</span></label>{look.backgroundMode !== "color" && <label><input aria-label="Segunda cor do gradiente" type="color" value={palette[1]} onChange={e => appearance({colors:[palette[0],e.target.value]})} /><span>{palette[1].toUpperCase()}</span></label>}</div></>}<Range label="Desfoque do fundo" min={0} max={30} value={look.backgroundBlur || 0} onChange={backgroundBlur=>appearance({backgroundBlur})} /><div className="section-line" /><h3>Enquadramento</h3><Range label="Margem" min={0} max={20} value={look.padding} suffix="%" onChange={padding => appearance({ padding })} /><Range label="Cantos arredondados" min={0} max={40} value={look.radius} onChange={radius => appearance({ radius })} /><Range label="Sombra" min={0} max={100} value={look.shadow} suffix="%" onChange={shadow => appearance({ shadow })} /><button className="wide subtle" onClick={() => { try { localStorage.setItem("frame-preset", JSON.stringify(look)); setNotice("Aparência salva como padrão para os próximos vídeos."); } catch { setError("Não foi possível salvar o preset local."); } }}>Salvar como padrão</button></>}
        {panel === "zoom" && <><div className="panel-title"><h2>Zooms dinâmicos</h2><span>Enquadre o que importa</span></div><div className="motion-options"><button className={!look.smooth ? "active" : ""} onClick={() => appearance({ smooth: false })}>◎ Focado</button><button className={look.smooth ? "active" : ""} onClick={() => appearance({ smooth: true })}>〰 Suave</button></div><button className="wide subtle" disabled={!media?.cursorCaptured} onClick={() => { if (media) { edit(p => ({ ...p, zooms: autoZooms(media.cursor, media.duration) })); setSelected(null); } }}>Gerar novamente pelos cliques</button>{!media?.cursorCaptured && <p className="help">Vídeos importados sem eventos de cursor usam zoom manual.</p>}<button className="wide subtle" onClick={() => addZoom()}>＋ Adicionar zoom aqui</button>{currentZoom ? <><div className="section-line" /><h3>Zoom selecionado</h3><label className="switch-label">Seguir cursor<input type="checkbox" disabled={!media?.cursorCaptured} checked={currentZoom.follow || false} onChange={e => zoomChange({ follow: e.target.checked })} /></label><label className="switch-label">Ativo<input type="checkbox" checked={currentZoom.enabled} onChange={e => zoomChange({ enabled: e.target.checked })} /></label><Range label="Ampliação" min={1} max={3} step={.05} value={currentZoom.scale} suffix="×" onChange={scale => zoomChange({ scale })} /><Range label="Posição horizontal" min={0} max={1} step={.01} value={currentZoom.x} onChange={x => zoomChange({ x })} /><Range label="Posição vertical" min={0} max={1} step={.01} value={currentZoom.y} onChange={y => zoomChange({ y })} /><div className="time-inputs"><label>Início<input aria-label="Início do zoom" type="number" min={0} max={currentZoom.end - .1} step={.1} value={Number(currentZoom.start.toFixed(2))} onChange={e => zoomChange({ start: clamp(Number(e.target.value), 0, currentZoom.end - .1) })} /></label><label>Fim<input aria-label="Fim do zoom" type="number" min={currentZoom.start + .1} max={media?.duration} step={.1} value={Number(currentZoom.end.toFixed(2))} onChange={e => zoomChange({ end: clamp(Number(e.target.value), currentZoom.start + .1, media?.duration || 1) })} /></label></div><p className="help">Clique na prévia para escolher o foco. Os zooms entram e saem suavemente.</p><button className="wide danger" onClick={() => { edit(p => ({ ...p, zooms: p.zooms.filter(z => z.id !== selected) })); setSelected(null); }}>Remover zoom</button></> : <p className="help">Selecione um bloco roxo na timeline para ajustar duração, intensidade e foco.</p>}</>}
        {panel === "cursor" && <><div className="panel-title"><h2>Cursor</h2><span>Movimento e visibilidade</span></div><h3>Estilo do cursor</h3><button className="wide subtle" onClick={()=>appearance({cursorAsset:undefined})}>Ponteiro padrão</button><select className="asset-group" aria-label="Coleção de cursores" value={cursorGroup} onChange={e=>setCursorGroup(e.target.value)}>{[...new Set(assetCatalog.cursors.map(item=>item.group))].map(group=><option key={group} value={group}>{group}</option>)}</select><div className="asset-grid cursor-grid">{assetRoot && assetCatalog.cursors.filter(item=>item.group===cursorGroup).map(item=><button key={item.id} className={look.cursorAsset===item.id?"selected":""} title={item.label} aria-label={item.label} aria-pressed={look.cursorAsset===item.id} onClick={()=>appearance({cursorAsset:item.id})}><img loading="lazy" src={assetURL(item.file)} alt="" /></button>)}</div><Range label="Tamanho" min={0} max={64} value={look.cursorSize} onChange={cursorSize => appearance({ cursorSize })} /><label className="switch-label">Movimento suave<input type="checkbox" checked={cursorSmooth} onChange={e => appearance({ cursorSmooth: e.target.checked, cursorMotion: e.target.checked ? "medium" : "original" })} /></label><p className="help">{media?.cursorCaptured ? "Cursor reconstruído separadamente da gravação. Defina o tamanho como zero para ocultar." : "Este vídeo não tem trilha de cursor. O ponteiro já presente no vídeo não pode ser separado."}</p></>}
        {panel === "animations" && <><div className="panel-title"><h2>Animações</h2><span>Movimentos com intenção</span></div><h3>Animação da tela</h3><div className="motion-options"><button className={!look.smooth ? "active" : ""} onClick={() => appearance({smooth:false})}>Focado</button><button className={look.smooth ? "active" : ""} onClick={() => appearance({smooth:true})}>Suave</button></div><p className="help">{look.smooth ? "Transições mais longas e acompanhamento gradual para apresentações." : "A câmera estabiliza mais rápido para facilitar a leitura."}</p><div className="section-line" /><label className="switch-label">Inércia da câmera<input type="checkbox" checked={look.cameraSpring || false} onChange={e=>appearance({cameraSpring:e.target.checked})} /></label><h3>Animação do cursor</h3><div className="motion-options cursor-motion-options"><button className={cursorMotion === "original" ? "active" : ""} onClick={() => appearance({cursorSmooth:false,cursorMotion:"original"})}>Original</button><button className={cursorMotion === "smooth" ? "active" : ""} onClick={() => appearance({cursorSmooth:true,cursorMotion:"smooth"})}>Suave</button><button className={cursorMotion === "medium" ? "active" : ""} onClick={()=>appearance({cursorMotion:"medium",cursorSmooth:true})}>Médio</button><button className={cursorMotion === "rapid" ? "active" : ""} onClick={()=>appearance({cursorMotion:"rapid",cursorSmooth:true})}>Rápido</button></div><p className="help">A suavização preserva a posição dos cliques e funciona independentemente da animação da tela.</p></>}
        {project && <><div className="section-line" /><h3>Trecho de exportação</h3><div className="time-inputs"><label>De<input aria-label="Início do trecho" type="number" min={0} max={project.trim.end - .1} step={.1} value={Number(project.trim.start.toFixed(2))} onChange={e => { const start = clamp(Number(e.target.value), 0, project.trim.end - .1); edit(p => ({ ...p, trim: { ...p.trim, start } })); seek(start); }} /></label><label>Até<input aria-label="Fim do trecho" type="number" min={project.trim.start + .1} max={media?.duration} step={.1} value={Number(project.trim.end.toFixed(2))} onChange={e => edit(p => ({ ...p, trim: { ...p.trim, end: clamp(Number(e.target.value), p.trim.start + .1, media?.duration || 1) } }))} /></label></div></>}
      </fieldset></aside>
    </div>
    <section className="timeline" aria-label="Timeline"><div className="timeline-heading"><span><AppIcon name="settings" />Timeline</span><span>{project?.zooms.length || 0} zooms <span className="dot-divider">·</span> {media ? `${media.width} × ${media.height}` : "Nenhum vídeo"}</span></div><div className="ruler">{Array.from({ length: 7 }, (_, i) => <span key={i}>{clock((media?.duration || 10) * i / 6)}</span>)}</div><input className="seek-range" aria-label="Posição da reprodução" type="range" disabled={!media || busy} min={0} max={media?.duration || 10} step={.01} value={time} onChange={e => seek(Number(e.target.value))} /><div className="tracks"><div className="playhead" style={{ left: `${100 * time / (media?.duration || 10)}%` }} /><div className="clip-track" style={project && media ? { marginLeft: `${100 * project.trim.start / media.duration}%`, width: `${100 * (project.trim.end - project.trim.start) / media.duration}%` } : undefined}><span>{project?.name || "Seu vídeo aparece aqui"}</span><small>{media ? `${(project!.trim.end - project!.trim.start).toFixed(1)}s · original` : "Grave ou importe para começar"}</small></div><div className="zoom-track" onClick={e => { if (e.target !== e.currentTarget || !media) return; const rect = e.currentTarget.getBoundingClientRect(); addZoom((e.clientX - rect.left) / rect.width * media.duration); }}>
      {project?.zooms.map(z => <button key={z.id} className={`zoom-block ${selected === z.id ? "selected" : ""} ${!z.enabled ? "disabled-zoom" : ""}`} style={{ left: `${100 * z.start / (media?.duration || 1)}%`, width: `${100 * (z.end - z.start) / (media?.duration || 1)}%` }} disabled={busy} onPointerDown={e => dragZoom(e, z)} onClick={() => { const current = projectRef.current?.zooms.find(item => item.id === z.id) || z; setSelected(z.id); setPanel("zoom"); seek(current.start + (current.end - current.start) / 2); }} title={`${clock(z.start)} → ${clock(z.end)}`}><span>⌕ {z.scale.toFixed(2)}×</span></button>)}{!project?.zooms.length && <span className="track-placeholder">Clique nesta faixa para adicionar um zoom</span>}
    </div></div></section>
    <footer className="statusbar" role="status" aria-live="polite"><span className={error ? "error-text" : ""}>{error || notice || (desktop ? "Pronto · processamento local" : "Abra o desktop Tauri para importar e gravar.")}</span>{operation === "exporting" ? <div className="export-progress"><progress max={100} value={progress} /><span>{progress}%</span><button onClick={() => void stop()}>Cancelar</button></div> : <button onClick={() => void action("reveal_clip")} disabled={!desktop || busy || !media}>Mostrar no Finder ↗</button>}</footer>
  </main>;
}
