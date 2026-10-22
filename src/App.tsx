import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  autoZooms,
  backgrounds,
  cameraFromKeys,
  cameraKeys,
  cameraPoint,
  cameraViewportTransform,
  clamp,
  cursorAt,
  cursorMotionFor,
  defaults,
  isAutoZoom,
  smoothCursor,
  visibleSpans,
  zoomsForMode,
  type Appearance,
  type CursorEvent,
  type Zoom,
} from "./zoom";
import "./App.css";
import {
  cursorDimensions,
  cursorImage,
  cursorThemes,
  themeCursor,
} from "./cursor";
import { motionFrames } from "./motion";
import {
  clipSpeed,
  clipRanges,
  editedDuration,
  editedToSource,
  sourceToEdited,
  splitClip,
  formatTime,
  type Clip,
  type Effect,
} from "./timeline";
import assetCatalog from "./studio-assets.json";

type Media = {
  path: string;
  duration: number;
  width: number;
  height: number;
  cursor: CursorEvent[];
  cursorCaptured: boolean;
  webcamPath?: string;
};
type Webcam = {
  path: string;
  x: number;
  y: number;
  size: number;
  shape: "circle" | "rounded" | "square";
  keyframes?: WebcamKeyframe[];
  mode?: WebcamMode;
  easing?: WebcamEasing;
  opacity?: number;
  border?: number;
  shadow?: number;
  borderRadius?: number;
  layouts?: { portrait?: WebcamLayout; landscape?: WebcamLayout };
};
type WebcamMode = "static" | "manual" | "auto" | "hybrid";
type WebcamEasing = "linear" | "ease-in-out" | "ease-out";
type WebcamKeyframe = { t: number; x: number; y: number; size: number; opacity?: number; borderRadius?: number; easing?: WebcamEasing };
type WebcamLayout = { x: number; y: number; size: number; shape: Webcam["shape"]; opacity: number; border: number; shadow: number; borderRadius: number; mode: WebcamMode; keyframes: WebcamKeyframe[] };
type Project = {
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
  name: string;
  mediaPath: string;
  zooms: Zoom[];
  trim: Clip;
  clips?: Clip[];
  effects?: Effect[];
  backgroundAudio?: { path: string; volume: number };
  webcam?: Webcam;
  appearance: Appearance;
};
type Operation =
  | "idle"
  | "opening"
  | "saving"
  | "starting"
  | "recording"
  | "stopping"
  | "exporting";
type Panel =
  | "background"
  | "zoom"
  | "cursor"
  | "animations"
  | "clip"
  | "effect"
  | "audio"
  | "webcam";
const clock = formatTime;
function webcamForAspect(camera: Webcam, aspect: string): Webcam {
  const variant = aspect === "9:16" ? camera.layouts?.portrait : aspect === "16:9" ? camera.layouts?.landscape : undefined;
  return variant ? { ...camera, ...variant } : camera;
}
function webcamLayout(camera: Webcam): WebcamLayout {
  return { x: camera.x, y: camera.y, size: camera.size, shape: camera.shape, opacity: camera.opacity ?? 1, border: camera.border ?? 2, shadow: camera.shadow ?? 35, borderRadius: camera.borderRadius ?? (camera.shape === "circle" ? 0.5 : camera.shape === "rounded" ? 0.18 : 0), mode: camera.mode ?? (camera.keyframes?.length ? "manual" : "static"), keyframes: camera.keyframes ?? [] };
}
function webcamAt(camera: Webcam, time: number): Webcam & { opacity: number; borderRadius: number } {
  const mode = camera.mode ?? (camera.keyframes?.length ? "manual" : "static");
  const base = { ...camera, mode, opacity: camera.opacity ?? 1, border: camera.border ?? 2, shadow: camera.shadow ?? 35 };
  if (mode === "static") return { ...base, opacity: base.opacity, borderRadius: camera.shape === "circle" ? 0.5 : camera.shape === "rounded" ? 0.18 : 0 };
  const keys = camera.keyframes ?? [];
  if (!keys.length) return { ...base, opacity: base.opacity, borderRadius: camera.shape === "circle" ? 0.5 : camera.shape === "rounded" ? 0.18 : 0 };
  let index = keys.findIndex((key) => key.t >= time);
  if (index < 0) index = keys.length;
  const a = keys[Math.max(0, index - 1)] ?? keys[0], b = keys[Math.min(index, keys.length - 1)] ?? a;
  const raw = index === 0 ? 0 : index >= keys.length ? 1 : clamp((time - a.t) / Math.max(0.0001, b.t - a.t), 0, 1);
  const easing = a.easing ?? "ease-in-out";
  const amount = easing === "linear" ? raw : easing === "ease-out" ? 1 - (1 - raw) ** 3 : raw * raw * (3 - 2 * raw);
  const mix = (from: number | undefined, to: number | undefined, fallback: number) => (from ?? fallback) + ((to ?? fallback) - (from ?? fallback)) * amount;
  return { ...base, x: mix(a.x, b.x, base.x), y: mix(a.y, b.y, base.y), size: mix(a.size, b.size, base.size), opacity: mix(a.opacity, b.opacity, base.opacity), borderRadius: mix(a.borderRadius, b.borderRadius, camera.shape === "circle" ? 0.5 : camera.shape === "rounded" ? 0.18 : 0) };
}
function planWebcamState(state: Webcam & { opacity: number; borderRadius: number }, cameraScale: number, aspect: string, sizeFactor: number) {
  if (state.mode !== "auto" && state.mode !== "hybrid") return state;
  const side = state.size * sizeFactor;
  const overlappingFocus = Math.abs(state.x - 0.5) < side / 2 + 0.025 && Math.abs(state.y - 0.5) < side / 2 + 0.025;
  const margin = Math.max(state.size / 2, side / 2 + 0.025);
  const candidates = aspect === "9:16"
    ? [{ x: 1 - margin, y: 1 - margin }, { x: margin, y: 1 - margin }, { x: 1 - margin, y: margin }, { x: margin, y: margin }]
    : [{ x: 1 - margin, y: 1 - margin }, { x: margin, y: 1 - margin }, { x: 1 - margin, y: margin }, { x: margin, y: margin }];
  const target = overlappingFocus ? candidates.reduce((best, candidate) => Math.hypot(candidate.x - 0.5, candidate.y - 0.5) > Math.hypot(best.x - 0.5, best.y - 0.5) ? candidate : best) : { x: state.x, y: state.y };
  const raw = state.mode === "auto" ? clamp((cameraScale - 1.05) / 0.45, 0, 1) : overlappingFocus ? clamp((cameraScale - 1.08) / 0.42, 0, 1) : 0;
  const amount = raw * raw * (3 - 2 * raw);
  return { ...state, size: state.mode === "auto" ? state.size * (1 - amount * 0.16) : state.size, x: state.x + (target.x - state.x) * amount, y: state.y + (target.y - state.y) * amount };
}
function storedAppearance(): Appearance {
  try {
    const value = JSON.parse(localStorage.getItem("frame-preset") || "null");
    return value && typeof value.padding === "number"
      ? { ...defaults, ...value }
      : defaults;
  } catch {
    return defaults;
  }
}
function exportDimensions(
  resolution: number,
  aspect: string,
  media?: Media | null,
) {
  const ratio =
    aspect === "16:9"
      ? 16 / 9
      : aspect === "9:16"
        ? 9 / 16
        : aspect === "1:1"
          ? 1
          : (media?.width || 16) / (media?.height || 9);
  const short = resolution,
    long = (resolution * 16) / 9;
  const maxWidth = ratio >= 1 ? long : short,
    maxHeight = ratio >= 1 ? short : long;
  const width = Math.max(
    2,
    Math.round(Math.min(maxWidth, maxHeight * ratio) / 2) * 2,
  );
  return `${width} × ${Math.max(2, Math.round(width / ratio / 2) * 2)}`;
}
function AppIcon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    folder: <path d="M3 7V5h7l2 3h9v12H3V7h18" />,
    zoom: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 6 6M7 10h6M10 7v6" />
      </>
    ),
    cursor: <path d="m5 2 14 12-7 1 4 7-3 1-4-7-4 5Z" />,
    background: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <path d="m3 17 6-7 5 5 3-3 4 5" />
      </>
    ),
    play: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="m10 8 6 4-6 4Z" />
      </>
    ),
    pause: (
      <>
        <path d="M9 7v10M15 7v10" />
      </>
    ),
    export: (
      <>
        <path d="M12 16V2m-4 4 4-4 4 4M5 11H3v11h18V11h-2" />
      </>
    ),
    record: (
      <>
        <rect x="2" y="3" width="20" height="15" rx="3" />
        <path d="M8 22h8M12 18v4" />
      </>
    ),
    save: (
      <>
        <path d="M3 3h15l3 3v15H3ZM7 3v7h10V3M7 21v-7h10v7" />
      </>
    ),
    animations: (
      <>
        <path d="M3 17c3-15 6 15 10 0s5 0 8-10" />
        <path d="m17 6 4 1-1 4" />
      </>
    ),
    settings: (
      <>
        <path d="M3 6h18M3 12h18M3 18h18" />
        <circle cx="8" cy="6" r="2" />
        <circle cx="16" cy="12" r="2" />
        <circle cx="9" cy="18" r="2" />
      </>
    ),
    audio: (
      <>
        <path d="M3 10v4M7 7v10M11 4v16M15 8v8M19 10v4" />
      </>
    ),
    webcam: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M5 7h3l1.5-2h5L16 7h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.settings}
    </svg>
  );
}
function Range({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (n: number) => void;
}) {
  return (
    <label className="range-field">
      <span>
        {label}
        <output>
          {Number(value.toFixed(2))}
          {suffix}
        </output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={(e) => onChange(Number(e.currentTarget.value))}
      />
    </label>
  );
}
export default function App() {
  const [media, setMedia] = useState<Media | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [past, setPast] = useState<Project[]>([]),
    [future, setFuture] = useState<Project[]>([]);
  const histories = useRef<{ past: Project[]; future: Project[] }>({
    past: [],
    future: [],
  });
  const [panel, setPanel] = useState<Panel>("background");
  const [selectedClip, setSelectedClip] = useState<number | null>(null);
  const [selectedEffect, setSelectedEffect] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [operation, setOperation] = useState<Operation>("idle");
  const [notice, setNotice] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const pendingSeek = useRef(0);
  const [capturePermissionDenied, setCapturePermissionDenied] = useState(false);
  const [recordWebcam, setRecordWebcam] = useState(false);
  const [recordingCameraPosition, setRecordingCameraPosition] = useState({ x: 0.78, y: 0.78 });
  const [cameraPreviewReady, setCameraPreviewReady] = useState(false);
  const [cameraPreviewFrame, setCameraPreviewFrame] = useState("");
  const [cameraPreviewError, setCameraPreviewError] = useState("");
  const [error, setError] = useState("");
  const [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0),
    [elapsed, setElapsed] = useState(0);
  const [areaSize, setAreaSize] = useState({ width: 700, height: 400 });
  const [rate, setRate] = useState(1);
  const [previewQuality, setPreviewQuality] = useState(1);
  const [previewScale, setPreviewScale] = useState(1);
  const [webcamClipboard, setWebcamClipboard] = useState<WebcamKeyframe | null>(null);
  const [webcamKeyTimeDraft, setWebcamKeyTimeDraft] = useState<number | null>(null);
  const [reelMode, setReelMode] = useState(false);
  const exportDialog = useRef<HTMLDialogElement>(null);
  const [exportResolution, setExportResolution] = useState(2160);
  const [exportFps, setExportFps] = useState(60);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [assetRoot, setAssetRoot] = useState("");
  const [wallpaperGroup, setWallpaperGroup] = useState("macOS");
  const video = useRef<HTMLVideoElement>(null),
    videoViewport = useRef<HTMLDivElement>(null),
    audio = useRef<HTMLAudioElement>(null),
    clickSoundAudio = useRef<HTMLAudioElement>(null),
    webcamVideo = useRef<HTMLVideoElement>(null),
    plane = useRef<HTMLDivElement>(null),
    cursor = useRef<HTMLDivElement>(null),
    qualityCanvas = useRef<HTMLCanvasElement>(null),
    videoBackground = useRef<HTMLCanvasElement>(null);
  const motionCanvas = useRef<HTMLCanvasElement>(null),
    focusMarker = useRef<HTMLButtonElement>(null);
  const motionSample = useRef<HTMLCanvasElement | null>(null);
  const cursorImages = useRef(new Map<string, HTMLImageElement>());
  const scene = useRef<HTMLDivElement>(null),
    previewArea = useRef<HTMLDivElement>(null),
    inspector = useRef<HTMLElement>(null);
  useEffect(() => {
    if (inspector.current) inspector.current.scrollTop = 0;
  }, [panel]);
  const projectRef = useRef(project);
  projectRef.current = project;
  const mediaRef = useRef(media);
  mediaRef.current = media;
  const operationRef = useRef(operation);
  operationRef.current = operation;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const lastClickSoundTime = useRef<number | null>(null);
  const recordingCameraKeys = useRef<WebcamKeyframe[]>([]);
  const recordingCameraDrag = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const viewportRef = useRef({ width: 700, height: 400 });
  const desktop = isTauri(),
    busy = operation !== "idle";
  useEffect(() => {
    if (!desktop || !recordWebcam || operation !== "idle") {
      setCameraPreviewReady(false);
      setCameraPreviewFrame("");
      return;
    }
    setCameraPreviewReady(false);
    setCameraPreviewFrame("");
    setCameraPreviewError("");
    void invoke("start_camera_preview").catch((cause) => {
      const message = String(cause);
      setCameraPreviewError(message);
      setError(message);
    });
    return () => {
      void invoke("stop_camera_preview").catch(() => undefined);
      setCameraPreviewReady(false);
    };
  }, [desktop, recordWebcam, operation]);
  const look = project?.appearance || defaults;
  const ranges = useMemo(
    () => (project ? clipRanges(project.trim, project.clips) : []),
    [project?.trim, project?.clips],
  );
  const duration = editedDuration(ranges);
  const editedTime = sourceToEdited(time, ranges);
  const currentZoom = project?.zooms.find((z) => z.id === selected);
  const cameraMode = look.cameraMode ?? "hybrid";
  const currentEffect = project?.effects?.find(
    (effect) => effect.id === selectedEffect,
  );
  const selectedWebcam = project?.webcam ? webcamForAspect(project.webcam, look.aspect) : undefined;
  const webcamKeyed = !!selectedWebcam?.keyframes?.some((key) => Math.abs(key.t - time) < 0.02);
  const canEditCursor = !!media?.cursorCaptured && media.cursor.length > 0;
  const cursorMotion = cursorMotionFor(look);
  const events = useMemo(
    () =>
      cursorMotion === "original"
        ? media?.cursor || []
        : smoothCursor(
            media?.cursor || [],
            cursorMotion === "smooth"
              ? 0.1
              : cursorMotion === "rapid"
                ? 0.035
                : 0.065,
          ),
    [media, cursorMotion],
  );
  const clickTimes = useMemo(() => {
    const clicks: number[] = [];
    let wasDown = false;
    for (const point of media?.cursor ?? []) {
      const isDown = point.down || !!point.rightDown || !!point.middleDown;
      if (isDown && !wasDown) clicks.push(point.t);
      wasDown = isDown;
    }
    return clicks;
  }, [media?.cursor]);
  const cursorSmooth = cursorMotion !== "original";
  const sourceAspect = media ? media.width / media.height : 16 / 10;
  const cameraZooms = useMemo(
    () => zoomsForMode(project?.zooms ?? [], cameraMode),
    [project?.zooms, cameraMode],
  );
  const sceneAspect =
    look.aspect === "auto"
      ? sourceAspect
      : look.aspect === "16:9"
        ? 16 / 9
        : look.aspect === "9:16"
          ? 9 / 16
          : 1;
  const size = {
    width: Math.min(areaSize.width, areaSize.height * sceneAspect),
    height: Math.min(areaSize.height, areaSize.width / sceneAspect),
  };
  const cropFill = !!look.cropFill;
  const followCropCursor = !!look.cropFollowCursor;
  const webcamSizeFactor = look.aspect === "9:16" ? 0.65 : 1;
  const cameraPadding = (Math.min(size.width, size.height) * look.padding) / 100;
  const contentAspect =
    (size.width - 2 * cameraPadding) /
    (size.height - 2 * cameraPadding);
  const visibleVideo = visibleSpans(
    sourceAspect,
    contentAspect,
    cropFill,
  );
  const visibleSpanX = visibleVideo.x,
    visibleSpanY = visibleVideo.y;
  const trajectory = useMemo(
    () =>
      media && project
        ? cameraKeys(
            cameraZooms,
            media.duration,
            look.smooth,
            events,
            look.cameraSpring,
            visibleSpanX,
            visibleSpanY,
            followCropCursor && cameraMode !== "manual",
            look.aspect === "9:16",
            sourceAspect,
            contentAspect,
          )
        : [],
    [
      cameraZooms,
      media,
      look.smooth,
      look.cameraSpring,
      followCropCursor,
      cameraMode,
      look.aspect,
      events,
      visibleSpanX,
      visibleSpanY,
    ],
  );
  const cameraCuts = useMemo(
    () => trajectory.filter((k) => k.cut).map((k) => k.t),
    [trajectory],
  );
  const previewZoomScale = cameraFromKeys(time, trajectory).scale;
  const currentWebcam = selectedWebcam
    ? planWebcamState(webcamAt(selectedWebcam, time), previewZoomScale, look.aspect, webcamSizeFactor)
    : undefined;
  const currentClip =
    selectedClip === null
      ? null
      : (project?.clips ?? (media ? [{ start: 0, end: media.duration }] : []))[
          selectedClip
        ];
  const selectedCursor = cursorImage(look, cursorAt(time, events));
  const selectedWallpaper = assetCatalog.wallpapers.find(
    (item) => item.id === look.wallpaper,
  );
  const assetURL = (file: string) =>
    assetRoot ? convertFileSrc(`${assetRoot}/${file}`) : undefined;
  useEffect(() => {
    if (desktop)
      void invoke<string>("studio_asset_root")
        .then(setAssetRoot)
        .catch((e) => setError(String(e)));
  }, [desktop]);

  const edit = useCallback((update: (p: Project) => Project) => {
    const p = projectRef.current;
    if (!p || operationRef.current !== "idle") return;
    histories.current = {
      past: [...histories.current.past.slice(-49), p],
      future: [],
    };
    setPast(histories.current.past);
    setFuture([]);
    const next = update(p);
    projectRef.current = next;
    setProject(next);
  }, []);
  const undo = useCallback(() => {
    if (operationRef.current !== "idle" || !projectRef.current) return;
    const h = histories.current,
      previous = h.past[h.past.length - 1];
    if (!previous) return;
    histories.current = {
      past: h.past.slice(0, -1),
      future: [projectRef.current, ...h.future],
    };
    setPast(histories.current.past);
    setFuture(histories.current.future);
    setProject(previous);
    projectRef.current = previous;
    setSelected(null);
    setSelectedClip(null);
    setSelectedEffect(null);
  }, []);
  const redo = useCallback(() => {
    if (operationRef.current !== "idle" || !projectRef.current) return;
    const h = histories.current,
      next = h.future[0];
    if (!next) return;
    histories.current = {
      past: [...h.past, projectRef.current],
      future: h.future.slice(1),
    };
    setPast(histories.current.past);
    setFuture(histories.current.future);
    setProject(next);
    projectRef.current = next;
    setSelected(null);
    setSelectedClip(null);
    setSelectedEffect(null);
  }, []);
  const load = useCallback(
    (m: Media, document?: Project, documentPath?: string) => {
      video.current?.pause();
      setPlaying(false);
      setMedia(m);
      const loaded: Project = document || {
        version: m.webcamPath ? 11 : 1,
        mediaPath: m.path,
        name: m.path.split("/").pop() || "Novo take",
        zooms: autoZooms(m.cursor, m.duration),
        trim: { start: 0, end: m.duration },
        webcam: m.webcamPath
          ? {
              path: m.webcamPath,
              x: 0.78,
              y: 0.78,
              size: 0.24,
              shape: "circle",
            }
          : undefined,
        appearance: storedAppearance(),
      };
      // Resolve the old camera-dependent default once, then keep the two controls independent.
      const p: Project = {
        ...loaded,
        appearance: {
          ...loaded.appearance,
          clickSounds: loaded.appearance.clickSounds ?? defaults.clickSounds,
          clickSoundVolume:
            loaded.appearance.clickSoundVolume ?? defaults.clickSoundVolume,
          cursorMotion:
            loaded.appearance.cursorMotion ??
            ((loaded.appearance.cursorSmooth ?? loaded.appearance.smooth)
              ? "medium"
              : "original"),
        },
      };
      const packageEnd = m.path.lastIndexOf(".framestudio/");
      setProjectPath(
        documentPath?.endsWith(".framestudio")
          ? documentPath
          : packageEnd >= 0
            ? m.path.slice(0, packageEnd + ".framestudio".length)
            : "",
      );
      pendingSeek.current =
        clipRanges(p.trim, p.clips)[0]?.start ?? p.trim.start;
      setWallpaperGroup(
        assetCatalog.wallpapers.find(
          (item) => item.id === p.appearance.wallpaper,
        )?.group || "macOS",
      );
      const loadedProject = { ...p, effects: p.effects ?? [] };
      setProject(loadedProject);
      projectRef.current = loadedProject;
      setPast([]);
      setFuture([]);
      histories.current = { past: [], future: [] };
      setSelected(null);
      setSelectedClip(null);
      setSelectedEffect(null);
      setTime(clipRanges(p.trim, p.clips)[0]?.start ?? p.trim.start);
      setOperation("idle");
      setError("");
      setNotice(
        m.cursorCaptured
          ? `${p.zooms.length} zooms sugeridos pelos cliques. Você pode ajustar cada trecho.`
          : "Vídeo importado. Adicione zooms na faixa roxa; este arquivo não tem eventos de cursor.",
      );
    },
    [],
  );
  useEffect(() => {
    if (!desktop) return;
    let disposed = false;
    const cleanups: (() => void)[] = [];
    const register = async <T,>(name: string, handler: (data: T) => void) => {
      const off = await listen<T>(name, (e) => {
        if (!disposed) handler(e.payload);
      });
      if (disposed) off();
      else cleanups.push(off);
    };
    void register("screen-capture-permission", () =>
      setCapturePermissionDenied(true),
    );
    void register("recording-started", () => {
      setCapturePermissionDenied(false);
      setOperation("recording");
      setElapsed(0);
    });
    void register<string>("camera-preview-frame", (frame) => {
      setCameraPreviewFrame(`data:image/jpeg;base64,${frame}`);
      setCameraPreviewReady(true);
    });
    void register<string>("camera-preview-error", (message) => {
      setCameraPreviewError(message);
      setError(message);
    });
    void register<{ seconds: number }>("recording-time", (event) =>
      setElapsed(event.seconds),
    );
    void register<Media>("recording-finished", (m) => {
      setRecordWebcam(false);
      load(m);
      const keys = recordingCameraKeys.current.filter((key) => key.t <= m.duration).sort((a, b) => a.t - b.t);
      if (m.webcamPath && keys.length > 1) {
        const loaded = projectRef.current;
        if (loaded?.webcam) {
          const first = keys[0]!;
          const next = { ...loaded, version: 11 as const, webcam: { ...loaded.webcam, x: first.x, y: first.y, mode: "manual" as const, keyframes: keys } };
          projectRef.current = next;
          setProject(next);
        }
      }
      recordingCameraKeys.current = [];
    });
    void register<{ progress: number }>("export-progress", (e) =>
      setProgress(e.progress),
    );
    void register<{ path: string }>("export-finished", (e) => {
      setOperation("idle");
      setNotice(`Exportação concluída: ${e.path}`);
      setProgress(100);
    });
    void register("project-open-request", () => {
      if (operationRef.current !== "idle") return;
      void invoke<{ media: Media; project: Project; path: string } | null>(
        "take_pending_project",
      )
        .then((result) => {
          if (result) load(result.media, result.project, result.path);
        })
        .catch((e) => setError(String(e)));
    });
    void register<string>("operation-error", (message) => {
      setOperation("idle");
      setError(message);
    });
    return () => {
      disposed = true;
      cleanups.forEach((off) => off());
    };
  }, [desktop, load]);
  useEffect(() => {
    const element = previewArea.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setAreaSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const padding = (Math.min(size.width, size.height) * look.padding) / 100;
  const contentWidth = size.width - padding * 2,
    contentHeight = size.height - padding * 2,
    vw = cropFill
      ? Math.max(contentWidth, contentHeight * sourceAspect)
      : Math.min(contentWidth, contentHeight * sourceAspect),
    vh = vw / sourceAspect;
  const renderData = useRef({
    trajectory,
    events,
    clickTimes,
    assetRoot,
    ranges,
    cameraCuts,
    currentZoom,
    visibleSpanX,
    visibleSpanY,
    sceneWidth: size.width,
    sceneHeight: size.height,
    quality: previewQuality,
  });
  renderData.current = {
    trajectory,
    events,
    clickTimes,
    assetRoot,
    ranges,
    cameraCuts,
    currentZoom,
    visibleSpanX,
    visibleSpanY,
    sceneWidth: size.width,
    sceneHeight: size.height,
    quality: previewQuality,
  };
  viewportRef.current = { width: vw, height: vh };
  renderData.current = {
    trajectory,
    events,
    clickTimes,
    assetRoot,
    ranges,
    cameraCuts,
    currentZoom,
    visibleSpanX,
    visibleSpanY,
    sceneWidth: size.width,
    sceneHeight: size.height,
    quality: previewQuality,
  };
  const draw = useCallback((t: number) => {
    const p = projectRef.current,
      m = mediaRef.current;
    if (!p || !m) return;
    const data = renderData.current,
      cam = cameraFromKeys(t, data.trajectory),
      view = viewportRef.current;
    const previousSoundTime = lastClickSoundTime.current;
    if (
      playingRef.current &&
      p.appearance.clickSounds !== false &&
      previousSoundTime !== null &&
      t >= previousSoundTime
    ) {
      const volume = clamp(p.appearance.clickSoundVolume ?? 0.3, 0, 1);
      if (volume > 0) {
        for (const clickTime of data.clickTimes) {
          if (clickTime <= previousSoundTime || clickTime > t) continue;
          if (!data.ranges.some((range) => clickTime >= range.start && clickTime < range.end)) continue;
          const base = clickSoundAudio.current;
          if (!base) continue;
          const sound = base.cloneNode(true) as HTMLAudioElement;
          sound.volume = volume;
          sound.addEventListener("ended", () => sound.remove(), { once: true });
          void sound.play().catch(() => sound.remove());
        }
      }
    }
    lastClickSoundTime.current = t;
    if (videoViewport.current) {
      const transform = cameraViewportTransform(cam, view.width, view.height, data.sceneWidth, data.sceneHeight);
      videoViewport.current.style.transformOrigin = "top left";
      videoViewport.current.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
    }
    if (plane.current) plane.current.style.transform = "none";
    const clip =
      renderData.current.ranges.find(
        (clip) => t >= clip.start && t < clip.end,
      ) ?? renderData.current.ranges[renderData.current.ranges.length - 1];
    const cursorEvents = clip?.cursorOriginal
      ? m.cursor
      : renderData.current.events;
    const point = cursorAt(t, cursorEvents);
    if (cursor.current)
      cursor.current.style.display =
        point &&
        !clip?.hideCursor &&
        m.cursorCaptured &&
        p.appearance.cursorSize > 0
          ? "block"
          : "none";
    const focus = renderData.current.currentZoom;
    if (focusMarker.current && focus) {
      focusMarker.current.style.left = `${focus.x * view.width}px`;
      focusMarker.current.style.top = `${focus.y * view.height}px`;
    }
    if (cursor.current && point) {
      const cursorPosition = cameraPoint(cam, point, view.width, view.height, data.sceneWidth, data.sceneHeight);
      cursor.current.style.left = `${cursorPosition.x}px`;
      cursor.current.style.top = `${cursorPosition.y}px`;
      const entry = cursorImage(p.appearance, point),
        image = cursor.current.querySelector("img");
      const dimensions = cursorDimensions(
        entry,
        p.appearance.cursorSize,
        scene.current?.clientWidth || 700,
        cam.scale,
      );
      cursor.current.style.width = `${dimensions.width}px`;
      cursor.current.style.height = `${dimensions.height}px`;
      if (image) {
        const src = renderData.current.assetRoot
          ? convertFileSrc(`${renderData.current.assetRoot}/${entry.file}`)
          : "";
        if (image.getAttribute("src") !== src) image.setAttribute("src", src);
        image.style.transform = `translate(${-entry.hotspotX * 100}%,${-entry.hotspotY * 100}%)`;
      }
    }
    const canvas = motionCanvas.current,
      source = video.current;
    const background = videoBackground.current,
      sceneElement = scene.current;
    if (
      background &&
      sceneElement &&
      source &&
      source.readyState >= 2 &&
      p.appearance.backgroundMode === "video-blur"
    ) {
      const density = Math.min(window.devicePixelRatio || 1, 2),
        width = Math.max(1, Math.round(sceneElement.clientWidth * density)),
        height = Math.max(1, Math.round(sceneElement.clientHeight * density));
      if (background.width !== width || background.height !== height) {
        background.width = width;
        background.height = height;
      }
      const context = background.getContext("2d");
      if (context) {
        const sourceAspect = source.videoWidth / source.videoHeight,
          targetAspect = width / height;
        const sx =
          sourceAspect > targetAspect
            ? (source.videoWidth - source.videoHeight * targetAspect) / 2
            : 0;
        const sy =
          sourceAspect < targetAspect
            ? (source.videoHeight - source.videoWidth / targetAspect) / 2
            : 0;
        const sw =
          sourceAspect > targetAspect
            ? source.videoHeight * targetAspect
            : source.videoWidth;
        const sh =
          sourceAspect < targetAspect
            ? source.videoWidth / targetAspect
            : source.videoHeight;
        context.clearRect(0, 0, width, height);
        context.globalAlpha = 0.9;
        context.filter = `blur(${(((p.appearance.backgroundBlur ?? 18) * sceneElement.clientWidth) / 1920) * density}px) brightness(82%)`;
        context.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);
        context.filter = "none";
        context.globalAlpha = 1;
      }
    } else if (background) {
      const context = background.getContext("2d");
      context?.clearRect(0, 0, background.width, background.height);
    }
    const blur = p.appearance.motionBlur;
    const enabled = !!blur && !!(blur.cursor || blur.zoom || blur.pan);
    if (plane.current)
      plane.current.style.visibility = enabled ? "hidden" : "visible";
    if (cursor.current)
      cursor.current.style.visibility = enabled ? "hidden" : "visible";
    const proxy = qualityCanvas.current;
    const useProxy = data.quality < 1 && !enabled;
    if (source) source.style.visibility = useProxy ? "hidden" : "visible";
    if (proxy) proxy.hidden = !useProxy;
    if (useProxy && proxy && source && source.readyState >= 2) {
      const density = Math.min(window.devicePixelRatio || 1, 2) * data.quality;
      const width = Math.max(1, Math.round(view.width * density)),
        height = Math.max(1, Math.round(view.height * density));
      if (proxy.width !== width || proxy.height !== height) {
        proxy.width = width;
        proxy.height = height;
      }
      const context = proxy.getContext("2d");
      if (context) {
        context.imageSmoothingQuality = "high";
        context.drawImage(
          source,
          0,
          0,
          source.videoWidth,
          source.videoHeight,
          0,
          0,
          width,
          height,
        );
      }
    }
    if (canvas) canvas.hidden = !enabled;
    if (enabled && canvas && source && source.readyState >= 2 && clip) {
      const density = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(view.width * density)),
        height = Math.max(1, Math.round(view.height * density));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const sampleCanvas = (motionSample.current ??=
        document.createElement("canvas"));
      if (sampleCanvas.width !== width || sampleCanvas.height !== height) {
        sampleCanvas.width = width;
        sampleCanvas.height = height;
      }
      const sampleCtx = sampleCanvas.getContext("2d");
      if (!sampleCtx) return;
      sampleCtx.imageSmoothingQuality = "high";
      const frames = motionFrames(
        t,
        renderData.current.trajectory,
        cursorEvents,
        clip,
        blur,
        renderData.current.cameraCuts,
        data.visibleSpanX,
        data.visibleSpanY,
      );
      for (const sample of frames) {
        const camera = sample.camera;
        const relativeScale = camera.scale / cam.scale;
        sampleCtx.setTransform(1, 0, 0, 1, 0, 0);
        sampleCtx.clearRect(0, 0, width, height);
        sampleCtx.setTransform(
          density * relativeScale,
          0,
          0,
          density * relativeScale,
          width * (cam.x - camera.x * relativeScale),
          height * (cam.y - camera.y * relativeScale),
        );
        sampleCtx.drawImage(
          source,
          0,
          0,
          source.videoWidth,
          source.videoHeight,
          0,
          0,
          view.width,
          view.height,
        );
        if (sample.cursor && m.cursorCaptured && p.appearance.cursorSize > 0) {
          const entry = cursorImage(p.appearance, sample.cursor);
          const src = renderData.current.assetRoot
            ? convertFileSrc(`${renderData.current.assetRoot}/${entry.file}`)
            : "";
          let image = cursorImages.current.get(src);
          if (!image && src) {
            image = new Image();
            image.onload = () => draw(video.current?.currentTime ?? t);
            image.src = src;
            cursorImages.current.set(src, image);
          }
          if (image?.complete && image.naturalWidth) {
            const dimensions = cursorDimensions(
              entry,
              p.appearance.cursorSize,
              scene.current?.clientWidth || 700,
            );
            const x = sample.cursor.x * view.width,
              y = sample.cursor.y * view.height;
            sampleCtx.drawImage(
              image,
              x - entry.hotspotX * dimensions.width,
              y - entry.hotspotY * dimensions.height,
              dimensions.width,
              dimensions.height,
            );
          }
        }
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 1 / frames.length;
        ctx.drawImage(sampleCanvas, 0, 0);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }
  }, []);
  useEffect(() => {
    draw(video.current?.currentTime || time);
  }, [project, size, time, draw, selected, panel, previewQuality]);
  useEffect(() => {
    const element = video.current;
    if (!element || !playing) return;
    let frame = 0,
      lastUpdate = 0,
      active = true;
    if (plane.current) plane.current.style.willChange = "transform";
    const tick = () => {
      if (!active) return;
      const p = projectRef.current;
      if (p) {
        const kept = renderData.current.ranges,
          first = kept[0],
          last = kept[kept.length - 1];
        if (!first || !last || element.currentTime >= last.end) {
          element.pause();
          if (last) {
            element.currentTime = last.end;
            setTime(last.end);
          }
          setPlaying(false);
          return;
        }
        const next = kept.find((clip) => element.currentTime < clip.end);
        if (next && element.currentTime < next.start) {
          element.currentTime = next.start;
          setTime(next.start);
        }
      }
      const current = renderData.current.ranges.find(
        (clip) =>
          element.currentTime >= clip.start && element.currentTime < clip.end,
      );
      element.playbackRate = rate * (current ? clipSpeed(current) : 1);
      const facecam = webcamVideo.current;
      if (facecam && p?.webcam) {
        facecam.playbackRate = element.playbackRate;
        if (Math.abs(facecam.currentTime - element.currentTime) > 0.2)
          facecam.currentTime = element.currentTime;
      }
      const soundtrack = audio.current;
      if (soundtrack?.duration && Number.isFinite(soundtrack.duration)) {
        const audioTime =
          sourceToEdited(element.currentTime, renderData.current.ranges) %
          soundtrack.duration;
        if (Math.abs(soundtrack.currentTime - audioTime) > 0.2)
          soundtrack.currentTime = audioTime;
      }
      draw(element.currentTime);
      if (performance.now() - lastUpdate > 250) {
        setTime(element.currentTime);
        lastUpdate = performance.now();
      }
      // Camera/cursor still animate over a held video frame from an idle screen.
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      if (plane.current) plane.current.style.willChange = "";
    };
  }, [playing, draw, rate]);
  const seek = useCallback(
    (t: number) => {
      const p = projectRef.current;
      if (!p) return;
      const kept = clipRanges(p.trim, p.clips);
      const next = editedToSource(sourceToEdited(t, kept), kept);
      lastClickSoundTime.current = next;
      if (video.current) video.current.currentTime = next;
      if (
        webcamVideo.current &&
        projectRef.current?.webcam &&
        webcamVideo.current.readyState >= 1
      )
        webcamVideo.current.currentTime = next;
      if (audio.current?.duration)
        audio.current.currentTime =
          sourceToEdited(next, kept) % audio.current.duration;
      setTime(next);
      draw(next);
    },
    [draw],
  );
  const togglePlay = useCallback(async () => {
    const element = video.current,
      p = projectRef.current;
    if (!element || !p || operationRef.current !== "idle") return;
    if (element.paused) {
      const kept = clipRanges(p.trim, p.clips);
      if (!kept.length) return;
      if (element.currentTime >= kept[kept.length - 1]!.end - 0.02)
        element.currentTime = kept[0].start;
      else
        element.currentTime = editedToSource(
          sourceToEdited(element.currentTime, kept),
          kept,
        );
      lastClickSoundTime.current = element.currentTime;
      const clip = kept.find(
        (c) => element.currentTime >= c.start && element.currentTime < c.end,
      );
      element.playbackRate = rate * (clip ? clipSpeed(clip) : 1);
      try {
        const clickAudio = clickSoundAudio.current;
        if (clickAudio?.paused) {
          clickAudio.muted = true;
          void clickAudio
            .play()
            .then(() => {
              clickAudio.pause();
              clickAudio.currentTime = 0;
              clickAudio.muted = false;
            })
            .catch(() => {
              clickAudio.muted = false;
            });
        }
        await element.play();
      } catch (e) {
        setError(String(e));
      }
    } else element.pause();
  }, [rate]);
  const splitAtPlayhead = useCallback(() => {
    const p = projectRef.current,
      m = mediaRef.current;
    if (!p || !m || operationRef.current !== "idle") return;
    video.current?.pause();
    const t = video.current?.currentTime ?? 0;
    if (
      !clipRanges(p.trim, p.clips).some(
        (clip) => t - clip.start >= 0.1 && clip.end - t >= 0.1,
      )
    ) {
      setNotice(
        "Posicione o marcador a pelo menos 0,1 segundo das bordas para dividir.",
      );
      return;
    }
    const next = splitClip(p.clips ?? [{ start: 0, end: m.duration }], t);
    if (!next) return;
    edit((p) => ({
      ...p,
      version: p.version >= 4 ? p.version : 3,
      clips: next,
    }));
    setSelected(null);
    setSelectedClip(
      next.findIndex((clip) => Math.abs(clip.start - t) < 0.000001),
    );
    setSelectedEffect(null);
    setPanel("clip");
    setNotice("Trecho dividido. Selecione uma parte para apagar.");
  }, [edit]);
  const deleteSelection = useCallback(() => {
    const p = projectRef.current;
    if (!p || operationRef.current !== "idle") return;
    video.current?.pause();
    if (selected) {
      edit((p) => ({ ...p, zooms: p.zooms.filter((z) => z.id !== selected) }));
      setSelected(null);
      setNotice("Zoom removido. ⌘Z desfaz.");
      return;
    }
    if (selectedEffect) {
      edit((p) => ({
        ...p,
        version: 5,
        effects: (p.effects ?? []).filter(
          (effect) => effect.id !== selectedEffect,
        ),
      }));
      setSelectedEffect(null);
      setNotice("Máscara ou destaque removido. ⌘Z desfaz.");
      return;
    }
    if (webcamKeyed) {
      toggleWebcamKeyframe();
      setNotice("Ajuste da webcam removido. ⌘Z desfaz.");
      return;
    }
    if (selectedClip === null) return;
    const clips = (
      p.clips ?? [{ start: 0, end: mediaRef.current!.duration }]
    ).filter((_, index) => index !== selectedClip);
    const kept = clipRanges(p.trim, clips);
    if (editedDuration(kept) < 0.1) {
      setNotice(
        "Mantenha pelo menos 0,1 segundo de vídeo. Divida o trecho antes de apagar.",
      );
      return;
    }
    edit((p) => ({ ...p, clips }));
    setSelectedClip(null);
    const next = editedToSource(
      sourceToEdited(video.current?.currentTime ?? 0, kept),
      kept,
    );
    if (video.current) video.current.currentTime = next;
    setTime(next);
    draw(next);
    setNotice("Trecho apagado da edição. ⌘Z desfaz.");
  }, [selected, selectedClip, selectedEffect, webcamKeyed, edit, draw]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (exportDialog.current?.open) return;
      const target = e.target as HTMLElement;
      if (
        ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) ||
        target.isContentEditable
      )
        return;
      if (operationRef.current !== "idle") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        splitAtPlayhead();
        return;
      }
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        (selected || selectedClip !== null || selectedEffect || webcamKeyed)
      ) {
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        void togglePlay();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if (
        (e.key === "ArrowRight" || e.key === "ArrowLeft") &&
        projectRef.current
      ) {
        e.preventDefault();
        const kept = clipRanges(
          projectRef.current.trim,
          projectRef.current.clips,
        );
        const offset = e.key === "ArrowRight" ? 1 / 30 : -1 / 30;
        seek(
          editedToSource(
            sourceToEdited(video.current?.currentTime || 0, kept) + offset,
            kept,
          ),
        );
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    togglePlay,
    redo,
    undo,
    seek,
    splitAtPlayhead,
    deleteSelection,
    selected,
    selectedClip,
    selectedEffect,
    webcamKeyed,
  ]);
  async function action<T>(
    name: string,
    args?: Record<string, unknown>,
  ): Promise<T | undefined> {
    setError("");
    try {
      return await invoke<T>(name, args);
    } catch (e) {
      setError(String(e));
      setOperation("idle");
    }
  }
  async function chooseBackgroundAudio() {
    const path = await action<string | null>("choose_background_audio");
    if (path)
      edit((p) => ({
        ...p,
        version: 6,
        backgroundAudio: { path, volume: 0.25 },
      }));
  }
  function setBackgroundVolume(volume: number) {
    edit((p) => ({
      ...p,
      version: 6,
      backgroundAudio: p.backgroundAudio
        ? { ...p.backgroundAudio, volume }
        : undefined,
    }));
    if (audio.current) audio.current.volume = volume;
  }
  async function importVideo() {
    video.current?.pause();
    setOperation("opening");
    const m = await action<Media | null>("import_video");
    if (m) load(m);
    else setOperation("idle");
  }
  async function openProject() {
    video.current?.pause();
    setOperation("opening");
    const result = await action<{
      media: Media;
      project: Project;
      path: string;
    } | null>("open_project");
    if (result) load(result.media, result.project, result.path);
    else setOperation("idle");
  }
  async function saveProject(saveAs = false) {
    if (!project) return;
    video.current?.pause();
    setOperation("saving");
    const result = await action<{ path: string; media: Media } | null>(
      "save_project",
      { project, saveAs },
    );
    setOperation("idle");
    if (result) {
      pendingSeek.current = time;
      const rewrite = (p: Project): Project => ({
        ...p,
        version: p.effects?.length ? 5 : 4,
        mediaPath: result.media.path,
      });
      const next = rewrite(projectRef.current!);
      setProject(next);
      projectRef.current = next;
      histories.current = {
        past: histories.current.past.map(rewrite),
        future: histories.current.future.map(rewrite),
      };
      setPast(histories.current.past);
      setFuture(histories.current.future);
      setMedia(result.media);
      setProjectPath(result.path);
      setNotice(`Projeto salvo com mídia incluída: ${result.path}`);
    }
  }
  async function record() {
    video.current?.pause();
    setElapsed(0);
    setRecordingCameraPosition({ x: 0.78, y: 0.78 });
    recordingCameraKeys.current = recordWebcam ? [{ t: 0, x: 0.78, y: 0.78, size: 0.24 }] : [];
    recordingCameraDrag.current = null;
    await invoke("stop_camera_preview").catch(() => undefined);
    setOperation("starting");
    setNotice(
      recordWebcam
        ? "Aguardando a tela e a webcam. Autorize o acesso à câmera se solicitado."
        : "Aguardando os primeiros frames. Se solicitado, autorize a gravação de tela no macOS.",
    );
    await action("start_recording", { withWebcam: recordWebcam });
  }
  function recordingCameraPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (operation !== "recording") return;
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!bounds || !bounds.width || !bounds.height) return;
    const pointerX = (event.clientX - bounds.left) / bounds.width;
    const pointerY = (event.clientY - bounds.top) / bounds.height;
    recordingCameraDrag.current = { offsetX: pointerX - recordingCameraPosition.x, offsetY: pointerY - recordingCameraPosition.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function recordingCameraPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = recordingCameraDrag.current;
    const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!drag || !bounds || !bounds.width || !bounds.height) return;
    const x = clamp((event.clientX - bounds.left) / bounds.width - drag.offsetX, 0.12, 0.88);
    const y = clamp((event.clientY - bounds.top) / bounds.height - drag.offsetY, 0.12, 0.88);
    setRecordingCameraPosition({ x, y });
    const key = { t: Math.max(0, elapsed), x, y, size: 0.24 };
    const keys = recordingCameraKeys.current;
    const last = keys[keys.length - 1];
    if (last && last.t === 0 && key.t === 0) keys[0] = key;
    else if (last && last.t > 0 && key.t - last.t < 0.2) keys[keys.length - 1] = { ...key, t: last.t };
    else if (!last || key.t > last.t) keys.push(key);
  }
  function recordingCameraPointerUp() {
    const wasDragging = recordingCameraDrag.current !== null;
    recordingCameraDrag.current = null;
    if (!wasDragging) return;
    const keys = recordingCameraKeys.current;
    const last = keys[keys.length - 1];
    if (last && elapsed > last.t) keys.push({ ...recordingCameraPosition, t: elapsed, size: 0.24 });
  }
  async function stop() {
    const previous = operation;
    setOperation(previous === "exporting" ? "exporting" : "stopping");
    const ok = await action("stop_operation");
    if (ok === undefined && operationRef.current === "idle") return;
  }
  async function exportVideo() {
    if (!project || !media) return;
    video.current?.pause();
    setOperation("exporting");
    setProgress(0);
    const started = await action<boolean>("export_video", {
      settings: {
        start: project.trim.start,
        end: project.trim.end,
        ranges: clipRanges(project.trim, project.clips).map(
          ({ index: _index, ...clip }) => clip,
        ),
        effects: project.effects ?? [],
        backgroundAudio: project.backgroundAudio,
        webcam: project.webcam ? { ...webcamForAspect(project.webcam, project.appearance.aspect), layouts: undefined } : undefined,
        appearance: { ...project.appearance, cropFill },
        keys: trajectory,
        cursor: events,
        rawCursor: media.cursor,
        resolution: exportResolution,
        fps: exportFps,
      },
    });
    if (!started) setOperation("idle");
  }
  function appearance(patch: Partial<Appearance>) {
    edit((p) => ({
      ...p,
      version: 11,
      appearance: {
        ...p.appearance,
        ...(patch.smooth !== undefined
          ? { cursorSmooth: p.appearance.cursorSmooth ?? p.appearance.smooth }
          : {}),
        ...patch,
      },
    }));
  }
  function setClickSoundVolume(volume: number) {
    appearance({ clickSoundVolume: volume });
  }
  function setCameraMode(mode: NonNullable<Appearance["cameraMode"]>) {
    appearance({ cameraMode: mode });
    setSelected(null);
  }
  function changeTrim(trim: Clip) {
    const p = projectRef.current;
    if (!p) return;
    if (editedDuration(clipRanges(trim, p.clips)) < 0.1) {
      setNotice(
        "Escolha um intervalo que contenha pelo menos 0,1 segundo de vídeo mantido.",
      );
      return;
    }
    edit((p) => ({ ...p, trim }));
    seek(video.current?.currentTime ?? trim.start);
  }
  function zoomChange(patch: Partial<Zoom>) {
    edit((p) => ({
      ...p,
      version: 4,
      zooms: p.zooms.map((z) => {
        if (z.id !== selected) return z;
        const scale = patch.scale ?? z.scale,
          halfX = visibleSpanX / (2 * scale),
          halfY = visibleSpanY / (2 * scale);
        return {
          ...z,
          ...patch,
          manualOverride: true,
          ...(patch.x === undefined
            ? {}
            : { x: clamp(patch.x, halfX, 1 - halfX) }),
          ...(patch.y === undefined
            ? {}
            : { y: clamp(patch.y, halfY, 1 - halfY) }),
        };
      }),
    }));
  }
  function clipChange(patch: Partial<Clip>) {
    if (selectedClip === null || !media) return;
    const clips = (
      projectRef.current?.clips ?? [{ start: 0, end: media.duration }]
    ).map((clip, index) =>
      index === selectedClip ? { ...clip, ...patch } : clip,
    );
    if (
      projectRef.current &&
      editedDuration(clipRanges(projectRef.current.trim, clips)) < 0.1
    ) {
      setNotice("Mantenha pelo menos 0,1 segundo de vídeo editado.");
      return;
    }
    video.current?.pause();
    edit((p) => ({ ...p, version: 4, clips }));
  }
  function effectChange(patch: Partial<Effect>) {
    if (!selectedEffect) return;
    edit((p) => ({
      ...p,
      version: 5,
      effects: (p.effects ?? []).map((effect) =>
        effect.id === selectedEffect ? { ...effect, ...patch } : effect,
      ),
    }));
  }
  function webcamChange(patch: Partial<Webcam> & Partial<WebcamKeyframe>) {
    edit((p) => {
      if (!p.webcam) return p;
      const original = p.webcam, aspectKey = look.aspect === "9:16" ? "portrait" : look.aspect === "16:9" ? "landscape" : null;
      const camera = webcamForAspect(original, look.aspect), keys = camera.keyframes ?? [];
      const save = (value: Webcam): Project => ({ ...p, version: 11, webcam: aspectKey ? { ...original, layouts: { ...original.layouts, [aspectKey]: webcamLayout(value) } } : { ...value, layouts: original.layouts } });
      if (!keys.length || (camera.mode ?? "static") === "static") return save({ ...camera, ...patch });
      const at = clamp(time, p.trim.start, p.trim.end), value = webcamAt(camera, at);
      const key: WebcamKeyframe = { t: at, x: patch.x ?? value.x, y: patch.y ?? value.y, size: patch.size ?? value.size, opacity: patch.opacity ?? value.opacity, borderRadius: patch.borderRadius ?? value.borderRadius, easing: patch.easing ?? keys.find((item) => Math.abs(item.t - at) < 0.02)?.easing ?? "ease-in-out" };
      const index = keys.findIndex((item) => Math.abs(item.t - at) < 0.02);
      const nextKeys = index >= 0 ? keys.map((item, i) => i === index ? key : item) : [...keys, key].sort((a, b) => a.t - b.t);
      const { x: _x, y: _y, size: _size, opacity: _opacity, borderRadius: _radius, easing: _easing, ...basePatch } = patch;
      return save({ ...camera, ...basePatch, mode: "manual", keyframes: nextKeys });
    });
  }
  function toggleWebcamKeyframe() {
    edit((p) => {
      if (!p.webcam || !media) return p;
      const original = p.webcam, aspectKey = look.aspect === "9:16" ? "portrait" : look.aspect === "16:9" ? "landscape" : null;
      const camera = webcamForAspect(original, look.aspect), at = clamp(time, p.trim.start, p.trim.end), keys = [...(camera.keyframes ?? [])];
      const save = (value: Webcam): Project => ({ ...p, version: 11, webcam: aspectKey ? { ...original, layouts: { ...original.layouts, [aspectKey]: webcamLayout(value) } } : { ...value, layouts: original.layouts } });
      const index = keys.findIndex((item) => Math.abs(item.t - at) < 0.02);
      if (index >= 0) {
        keys.splice(index, 1);
        return save({ ...camera, keyframes: keys, mode: keys.length ? "manual" : "static" });
      }
      const state = webcamAt(camera, at);
      if (!keys.length) keys.push({ t: p.trim.start, x: camera.x, y: camera.y, size: camera.size, opacity: camera.opacity ?? 1, borderRadius: camera.borderRadius ?? (camera.shape === "circle" ? 0.5 : camera.shape === "rounded" ? 0.18 : 0), easing: "ease-in-out" });
      if (Math.abs(at - p.trim.start) >= 0.02) keys.push({ t: at, x: state.x, y: state.y, size: state.size, opacity: state.opacity, borderRadius: state.borderRadius, easing: "ease-in-out" });
      keys.sort((a, b) => a.t - b.t);
      return save({ ...camera, mode: "manual", keyframes: keys });
    });
  }
  function retimeWebcamKeyframe(nextTime: number) {
    if (!project?.webcam) return;
    const at = clamp(nextTime, project.trim.start, project.trim.end), original = project.webcam;
    const aspectKey = look.aspect === "9:16" ? "portrait" : look.aspect === "16:9" ? "landscape" : null;
    const camera = webcamForAspect(original, look.aspect), keys = camera.keyframes ?? [];
    const index = keys.findIndex((key) => Math.abs(key.t - time) < 0.02);
    if (index < 0 || keys.some((key, i) => i !== index && Math.abs(key.t - at) < 0.02)) return;
    const updated = { ...camera, keyframes: keys.map((key, i) => i === index ? { ...key, t: at } : key).sort((a, b) => a.t - b.t) };
    edit((p) => ({ ...p, version: 11, webcam: aspectKey ? { ...original, layouts: { ...original.layouts, [aspectKey]: webcamLayout(updated) } } : { ...updated, layouts: original.layouts } }));
  }
  function dragWebcam(event: React.PointerEvent<HTMLVideoElement>) {
    const original = projectRef.current;
    if (event.button !== 0 || busy || !original?.webcam) return;
    event.preventDefault();
    event.stopPropagation();
    video.current?.pause();
    const rect = event.currentTarget.closest(".scene")!.getBoundingClientRect(),
      startX = event.clientX,
      startY = event.clientY,
      aspectKey = look.aspect === "9:16" ? "portrait" : look.aspect === "16:9" ? "landscape" : null,
      initialCamera = webcamForAspect(original.webcam, look.aspect),
      initial = webcamAt(initialCamera, time);
    let saved = false;
    const move = (e: PointerEvent) => {
      const p = projectRef.current;
      if (!p?.webcam) return;
      if (!saved) {
        histories.current = {
          past: [...histories.current.past.slice(-49), original],
          future: [],
        };
        setPast(histories.current.past);
        setFuture([]);
        saved = true;
      }
      const base = p.webcam, camera = webcamForAspect(base, look.aspect), current = webcamAt(camera, time);
      const position = {
        x: clamp(
          initial.x + (e.clientX - startX) / rect.width,
          (current.size * webcamSizeFactor) / 2,
          1 - (current.size * webcamSizeFactor) / 2,
        ),
        y: clamp(
          initial.y + (e.clientY - startY) / rect.height,
          (current.size * webcamSizeFactor) / 2,
          1 - (current.size * webcamSizeFactor) / 2,
        ),
      };
      const keys = camera.keyframes ?? [];
      const key: WebcamKeyframe = { t: time, ...current, ...position, easing: "ease-in-out" };
      const updated: Webcam = keys.length
        ? { ...camera, mode: "manual", keyframes: [...keys.filter((item) => Math.abs(item.t - time) >= 0.02), key].sort((a, b) => a.t - b.t) }
        : { ...camera, ...position };
      const webcam: Webcam = aspectKey
        ? { ...base, layouts: { ...base.layouts, [aspectKey]: webcamLayout(updated) } }
        : { ...updated, layouts: base.layouts };
      const next = { ...p, version: 11 as const, webcam };
      projectRef.current = next;
      setProject(next);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }
  function addEffect(kind: Effect["kind"]) {
    if (!project || !media || busy) return;
    const start = clamp(time, 0, Math.max(0, media.duration - 0.1));
    const effect: Effect = {
      id: crypto.randomUUID(),
      kind,
      start,
      end: Math.min(media.duration, start + 2),
      x: 0.5,
      y: 0.5,
      width: 0.28,
      height: 0.22,
      opacity: 0.28,
    };
    edit((p) => ({
      ...p,
      version: 5,
      effects: [...(p.effects ?? []), effect],
    }));
    setSelected(null);
    setSelectedClip(null);
    setSelectedEffect(effect.id);
    setPanel("effect");
  }
  function dragEffect(
    event: React.PointerEvent<HTMLElement>,
    effect: Effect,
    kind: "move" | "resize" = "move",
  ) {
    if (event.button !== 0 || busy) return;
    event.preventDefault();
    event.stopPropagation();
    video.current?.pause();
    const viewport = event.currentTarget
        .closest(".video-viewport")!
        .getBoundingClientRect(),
      startX = event.clientX,
      startY = event.clientY,
      original = projectRef.current;
    if (!original) return;
    let saved = false;
    const move = (e: PointerEvent) => {
      const p = projectRef.current;
      if (!p) return;
      if (!saved) {
        histories.current = {
          past: [...histories.current.past.slice(-49), original],
          future: [],
        };
        setPast(histories.current.past);
        setFuture([]);
        saved = true;
      }
      const current = p.effects?.find((item) => item.id === effect.id);
      if (!current) return;
      const dx = ((e.clientX - startX) / viewport.width) * visibleSpanX,
        dy = ((e.clientY - startY) / viewport.height) * visibleSpanY;
      const nextEffect =
        kind === "move"
          ? {
              ...current,
              x: clamp(
                current.x + dx,
                current.width / 2,
                1 - current.width / 2,
              ),
              y: clamp(
                current.y + dy,
                current.height / 2,
                1 - current.height / 2,
              ),
            }
          : {
              ...current,
              width: clamp(
                current.width + dx,
                0.04,
                2 * Math.min(current.x, 1 - current.x),
              ),
              height: clamp(
                current.height + dy,
                0.04,
                2 * Math.min(current.y, 1 - current.y),
              ),
            };
      const next = {
        ...p,
        version: 5 as const,
        effects: p.effects?.map((item) =>
          item.id === effect.id ? nextEffect : item,
        ),
      };
      projectRef.current = next;
      setProject(next);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }
  function dragFocus(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || busy || !currentZoom || !project) return;
    event.preventDefault();
    event.stopPropagation();
    video.current?.pause();
    const viewport = event.currentTarget.parentElement!.getBoundingClientRect();
    const original = project,
      zoomId = currentZoom.id;
    let saved = false;
    const move = (e: PointerEvent) => {
      if (!saved) {
        histories.current = {
          past: [...histories.current.past.slice(-49), original],
          future: [],
        };
        setPast(histories.current.past);
        setFuture([]);
        saved = true;
      }
      const halfX = visibleSpanX / (2 * currentZoom.scale),
        halfY = visibleSpanY / (2 * currentZoom.scale);
      const x = clamp((e.clientX - viewport.left) / viewport.width, halfX, 1 - halfX);
      const y = clamp((e.clientY - viewport.top) / viewport.height, halfY, 1 - halfY);
      const p = projectRef.current;
      if (!p) return;
      const next: Project = {
        ...p,
        version: 4,
        zooms: p.zooms.map((z) =>
          z.id === zoomId
            ? { ...z, x, y, follow: false, manualOverride: true }
            : z,
        ),
      };
      projectRef.current = next;
      setProject(next);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }
  function addZoom(t = time) {
    if (!project || !media || busy) return;
    const start = clamp(t, 0, Math.max(0, media.duration - 0.2)),
      end = Math.min(media.duration, start + 2.4),
      point = cursorAt(t, media.cursor);
    const scale = 1.65,
      halfX = visibleSpanX / (2 * scale),
      halfY = visibleSpanY / (2 * scale);
    const z: Zoom = {
      id: crypto.randomUUID(),
      start,
      end,
      scale,
      x: clamp(point?.x ?? 0.5, halfX, 1 - halfX),
      y: clamp(point?.y ?? 0.5, halfY, 1 - halfY),
      enabled: true,
    };
    edit((p) => ({ ...p, zooms: [...p.zooms, z] }));
    setSelected(z.id);
    setSelectedClip(null);
    setSelectedEffect(null);
    setPanel("zoom");
    seek(Math.min(end, start + 0.7));
  }
  useEffect(() => {
    if (!desktop || operation !== "idle") return;
    void invoke<{ media: Media; project: Project; path: string } | null>(
      "take_pending_project",
    )
      .then((result) => {
        if (result) load(result.media, result.project, result.path);
      })
      .catch((e) => setError(String(e)));
  }, [desktop, operation, load]);
  useEffect(() => {
    if (!desktop || !project || !projectPath || busy) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void invoke<string | null>("autosave_project", { project })
        .then((path) => {
          if (active && path)
            setNotice(`Salvo automaticamente · ${path.split("/").pop()}`);
        })
        .catch((e) => {
          if (active)
            setError(`Não foi possível salvar automaticamente: ${String(e)}`);
        });
    }, 700);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [desktop, project, projectPath, busy]);
  function dragZoom(event: React.PointerEvent<HTMLButtonElement>, zoom: Zoom) {
    if (event.button !== 0 || busy || !media || !project) return;
    const rect = event.currentTarget.getBoundingClientRect(),
      track = event.currentTarget.parentElement!.getBoundingClientRect();
    const mode =
      event.clientX - rect.left < 8
        ? "start"
        : rect.right - event.clientX < 8
          ? "end"
          : "move";
    const startX = event.clientX,
      original = project;
    let moved = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      if (Math.abs(e.clientX - startX) < 2 && !moved) return;
      if (!moved) {
        histories.current = {
          past: [...histories.current.past.slice(-49), original],
          future: [],
        };
        setPast(histories.current.past);
        setFuture([]);
        moved = true;
      }
      const delta = ((e.clientX - startX) / track.width) * media.duration;
      const patch =
        mode === "start"
          ? { start: clamp(zoom.start + delta, 0, zoom.end - 0.1) }
          : mode === "end"
            ? { end: clamp(zoom.end + delta, zoom.start + 0.1, media.duration) }
            : (() => {
                const start = clamp(
                  zoom.start + delta,
                  0,
                  media.duration - (zoom.end - zoom.start),
                );
                return { start, end: start + zoom.end - zoom.start };
              })();
      const next = {
        ...original,
        zooms: original.zooms.map((z) =>
          z.id === zoom.id ? { ...z, ...patch, manualOverride: true } : z,
        ),
      };
      projectRef.current = next;
      setProject(next);
      setSelected(zoom.id);
      setSelectedClip(null);
      setPanel("zoom");
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }
  const palette =
    look.colors ||
    backgrounds[clamp(look.background, 0, backgrounds.length - 1)];
  const backgroundStyle =
    look.backgroundMode === "wallpaper" && selectedWallpaper && assetRoot
      ? `url("${assetURL(selectedWallpaper.file)}") center / cover`
      : look.backgroundMode === "color"
        ? palette[0]
        : `linear-gradient(135deg, ${palette[0]}, ${palette[1]})`;
  return (
    <main className="editor">
      <dialog
        className="export-dialog"
        ref={exportDialog}
        aria-labelledby="export-title"
      >
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            exportDialog.current?.close();
            void exportVideo();
          }}
        >
          <div className="export-heading">
            <span className="export-heading-icon">
              <AppIcon name="export" />
            </span>
            <div>
              <h2 id="export-title">Exportar vídeo</h2>
              <p>Escolha a qualidade do arquivo final</p>
            </div>
            <button
              type="button"
              className="export-close"
              aria-label="Fechar"
              onClick={() => exportDialog.current?.close()}
            >
              ×
            </button>
          </div>
          <section
            className="export-section"
            aria-labelledby="resolution-title"
          >
            <div className="export-section-title">
              <strong id="resolution-title">Resolução</strong>
              <span>
                {exportDimensions(exportResolution, look.aspect, media)} px
              </span>
            </div>
            <div
              className="export-choice-grid"
              role="group"
              aria-label="Resolução de exportação"
            >
              {[
                [480, "SD", "Arquivo leve"],
                [720, "HD", "Boa qualidade"],
                [1080, "Full HD", "Recomendado"],
                [1440, "QHD", "Alta definição"],
                [2160, "4K", "Máximo detalhe"],
              ].map(([value, label, detail]) => (
                <button
                  type="button"
                  key={value}
                  className={exportResolution === value ? "selected" : ""}
                  aria-pressed={exportResolution === value}
                  onClick={() => setExportResolution(Number(value))}
                >
                  <strong>{label}</strong>
                  <span>{value}p</span>
                  <small>{detail}</small>
                </button>
              ))}
            </div>
          </section>
          <section className="export-section">
            <div className="export-section-title">
              <strong>Quadros por segundo</strong>
              <span>Movimento</span>
            </div>
            <div
              className="export-fps-grid"
              role="group"
              aria-label="Quadros por segundo"
            >
              {[
                [24, "Cinema"],
                [30, "Padrão"],
                [60, "Fluido"],
              ].map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={exportFps === value ? "selected" : ""}
                  aria-pressed={exportFps === value}
                  onClick={() => setExportFps(Number(value))}
                >
                  <strong>{value} fps</strong>
                  <small>{label}</small>
                </button>
              ))}
            </div>
          </section>
          <div className="export-summary">
            <span className="export-summary-dot" />
            <span>
              <strong>MP4 · H.264</strong>
              <small>
                Proporção {look.aspect === "auto" ? "original" : look.aspect} ·
                aparência, zooms e cursor incluídos
              </small>
            </span>
          </div>
          <div className="export-dialog-actions">
            <button type="button" onClick={() => exportDialog.current?.close()}>
              Cancelar
            </button>
            <button
              className="export-button"
              type="submit"
              disabled={!project || busy}
            >
              Exportar vídeo{" "}
              <span>
                {exportResolution === 2160 ? "4K" : `${exportResolution}p`} ·{" "}
                {exportFps} fps
              </span>
            </button>
          </div>
        </form>
      </dialog>
      <header className="editor-header">
        <div className="header-left">
          <span className="brand-mark">▰</span>
          <strong>Frame Studio</strong>
          <button
            onClick={() => void importVideo()}
            disabled={!desktop || busy}
            title="Importar vídeo"
            aria-label="Importar vídeo"
          >
            <AppIcon name="folder" />
          </button>
          <button
            onClick={() => void openProject()}
            disabled={!desktop || busy}
          >
            Abrir projeto
          </button>
        </div>
        <span className="project-name">
          {project?.name || "Novo projeto"}
          <small>
            {projectPath
              ? ".framestudio · salvo no Mac"
              : project
                ? "· ainda não salvo"
                : "Local · macOS"}
          </small>
        </span>
        <div className="header-actions">
          <button
            disabled={!past.length || busy}
            onClick={undo}
            title="Desfazer ⌘Z"
            aria-label="Desfazer"
          >
            ↶
          </button>
          <button
            disabled={!future.length || busy}
            onClick={redo}
            title="Refazer ⇧⌘Z"
            aria-label="Refazer"
          >
            ↷
          </button>
          <span className="divider" />
          <div className="preset-control">
            <button
              disabled={!project || busy}
              aria-expanded={presetsOpen}
              onClick={() => setPresetsOpen(!presetsOpen)}
            >
              <AppIcon name="settings" />
              Presets⌄
            </button>
            {presetsOpen && (
              <>
                <button
                  className="menu-dismiss"
                  aria-label="Fechar presets"
                  onClick={() => setPresetsOpen(false)}
                />
                <div className="preset-menu">
                  {[
                    {
                      name: "Estúdio",
                      description: "Violeta · movimento suave",
                      value: { ...defaults, cursorSmooth: true },
                    },
                    {
                      name: "Foco",
                      description: "Grafite · enquadramento próximo",
                      value: {
                        ...defaults,
                        background: 4,
                        padding: 4,
                        radius: 8,
                        shadow: 25,
                        smooth: false,
                        cursorSmooth: true,
                      },
                    },
                    {
                      name: "Cinema",
                      description: "Oceano · 16:9 · margem ampla",
                      value: {
                        ...defaults,
                        background: 1,
                        padding: 14,
                        radius: 18,
                        shadow: 55,
                        aspect: "16:9",
                        cursorSmooth: true,
                      },
                    },
                  ].map((preset) => (
                    <button
                      key={preset.name}
                      onClick={() => {
                        appearance({
                          ...preset.value,
                          colors: undefined,
                          backgroundMode: "gradient",
                          wallpaper: undefined,
                          cursorAsset: undefined,
                          cursorMotion: undefined,
                          cameraSpring: false,
                          backgroundBlur: 0,
                          motionBlur: undefined,
                        });
                        setPresetsOpen(false);
                      }}
                    >
                      <strong>{preset.name}</strong>
                      <small>{preset.description}</small>
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      appearance(storedAppearance());
                      setPresetsOpen(false);
                    }}
                  >
                    Meu padrão salvo
                  </button>
                </div>
              </>
            )}
          </div>
          <button
            disabled={!project || busy}
            onClick={() => void saveProject(true)}
            title="Criar uma cópia independente do projeto"
          >
            Salvar como
          </button>
          <button
            disabled={!project || busy}
            onClick={() => void saveProject()}
          >
            <AppIcon name="save" />
            Salvar
          </button>
          <button
            className="export-button"
            disabled={!project || busy}
            onClick={() => {
              video.current?.pause();
              exportDialog.current?.showModal();
            }}
          >
            <AppIcon name="export" />
            Exportar
          </button>
        </div>
      </header>
      <div className="editor-body">
        <section className="preview-column">
          <div className="preview-toolbar">
            <label>
              <AppIcon name="record" />
              <select
                aria-label="Proporção do vídeo"
                value={look.aspect}
                disabled={!project || busy}
                onChange={(e) => appearance({ aspect: e.target.value })}
              >
                <option value="auto">Auto</option>
                <option>16:9</option>
                <option value="9:16">Vertical 9:16</option>
                <option>1:1</option>
              </select>
            </label>
            <button
              className={cropFill ? "toolbar-active" : ""}
              disabled={!project || busy}
              aria-pressed={cropFill}
              onClick={() => appearance({ cropFill: !cropFill })}
            >
              ⌗ Crop
            </button>
            <button
              className={reelMode ? "toolbar-active" : ""}
              disabled={!project || busy}
              aria-pressed={reelMode}
              onClick={() => setReelMode((value) => !value)}
            >
              ▣ Reel mode
            </button>
            {look.aspect === "9:16" &&
              cropFill &&
              (visibleSpanX < 0.999 || visibleSpanY < 0.999) && (
                <button
                  className={followCropCursor ? "toolbar-active" : ""}
                  disabled={!project || busy || !media?.cursorCaptured}
                  aria-pressed={followCropCursor}
                  title="A câmera move o recorte vertical suavemente para acompanhar o cursor"
                  onClick={() =>
                    appearance({ cropFollowCursor: !followCropCursor })
                  }
                >
                  ↝ Acompanhar cursor
                </button>
              )}
            <label className="preview-quality">
              ✺ Preview quality{" "}
              <select
                aria-label="Qualidade da prévia"
                value={previewQuality}
                onChange={(e) => setPreviewQuality(Number(e.target.value))}
              >
                <option value={1}>Full</option>
                <option value={0.5}>Half</option>
                <option value={0.25}>Quarter</option>
              </select>
            </label>
            <button
              className="preview-zoom-button"
              disabled={previewScale <= 0.6}
              aria-label="Diminuir zoom da prévia"
              title="Diminuir zoom da prévia"
              onClick={() =>
                setPreviewScale((value) => Math.max(0.6, value - 0.1))
              }
            >
              −
            </button>
            <button
              className="preview-zoom-button"
              disabled={previewScale >= 1.4}
              aria-label="Aumentar zoom da prévia"
              title="Aumentar zoom da prévia"
              onClick={() =>
                setPreviewScale((value) => Math.min(1.4, value + 0.1))
              }
            >
              ＋
            </button>
            <button
              className={`toolbar-button ${recordWebcam ? "toolbar-active" : ""}`}
              disabled={!desktop || busy}
              aria-pressed={recordWebcam}
              onClick={() => {
                setRecordWebcam((v) => !v);
                setPanel("webcam");
              }}
              title="Incluir webcam na próxima gravação"
            >
              ◉ Webcam {recordWebcam ? "ativa" : "desativada"}
            </button>
            <button
              className="new-recording"
              disabled={!desktop || busy}
              onClick={() => void record()}
            >
              <span className="red-dot" />
              Nova gravação
            </button>
          </div>
          <div className="preview-area" ref={previewArea}>
            <div
              ref={scene}
              className={`scene${reelMode ? " reel-preview" : ""}`}
              style={
                {
                  width: size.width,
                  height: size.height,
                  transform: `scale(${previewScale})`,
                } as React.CSSProperties
              }
            >
              {reelMode && (
                <div className="reel-ui" aria-hidden="true">
                  <div className="reel-top">
                    <span>‹</span>
                    <strong>Reels</strong>
                    <span>◎</span>
                  </div>
                  <div className="reel-actions">
                    <span>
                      ♡<small>24,8 mil</small>
                    </span>
                    <span>
                      ◯<small>128</small>
                    </span>
                    <span>
                      ➤<small>97</small>
                    </span>
                    <span>•••</span>
                  </div>
                  <div className="reel-bottom">
                    <div className="reel-profile">
                      <i /> <strong>screencastudio</strong>
                      <em>Seguir</em>
                    </div>
                    <span>Uma gravação de tela, com zoom e movimento.</span>
                    <small>♫ Áudio original</small>
                  </div>
                </div>
              )}
              <div
                className="scene-background"
                style={{
                  background: backgroundStyle,
                  filter: `blur(${((look.backgroundBlur || 0) * size.width) / 1920}px)`,
                }}
              />
              <canvas
                className="video-background"
                ref={videoBackground}
                aria-hidden="true"
              />
              {media ? (
                <>
                <div
                  className="video-viewport"
                  ref={videoViewport}
                  style={{
                    width: vw,
                    height: vh,
                    left: (size.width - vw) / 2,
                    top: (size.height - vh) / 2,
                    borderRadius: (look.radius * size.width) / 1000,
                    boxShadow: `0 ${(12 * size.width) / 1920}px ${(36 * size.width) / 1920}px rgba(0,0,0,${look.shadow / 100})`,
                  }}
                  onClick={(e) => {
                    if (panel !== "zoom" || !currentZoom || busy) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    zoomChange({
                      x: clamp((e.clientX - rect.left) / rect.width, 0, 1),
                      y: clamp((e.clientY - rect.top) / rect.height, 0, 1),
                      follow: false,
                    });
                  }}
                >
                  <div
                    className="media-plane"
                    ref={plane}
                    style={{
                      width: vw,
                      height: vh,
                    }}
                  >
                    <video
                      ref={video}
                      src={convertFileSrc(media.path)}
                      playsInline
                      preload="metadata"
                      onLoadedMetadata={() => {
                        if (video.current) video.current.playbackRate = rate;
                        seek(pendingSeek.current);
                      }}
                      onLoadedData={() => draw(video.current?.currentTime ?? 0)}
                      onPlay={() => {
                        setPlaying(true);
                        if (projectRef.current?.webcam)
                          void webcamVideo.current
                            ?.play()
                            .catch((e) => setError(String(e)));
                        if (projectRef.current?.backgroundAudio)
                          void audio.current
                            ?.play()
                            .catch((e) => setError(String(e)));
                      }}
                      onPause={() => {
                        setPlaying(false);
                        audio.current?.pause();
                        webcamVideo.current?.pause();
                      }}
                      onSeeked={() => draw(video.current?.currentTime || 0)}
                      onError={() =>
                        setError(
                          "Não foi possível reproduzir este codec. Tente um vídeo H.264 em MOV ou MP4.",
                        )
                      }
                    />
                    <audio
                      ref={audio}
                      src={
                        project?.backgroundAudio
                          ? convertFileSrc(project.backgroundAudio.path)
                          : undefined
                      }
                      loop
                      preload="metadata"
                      hidden
                      onLoadedMetadata={(e) => {
                        const a = e.currentTarget,
                          kept = projectRef.current
                            ? clipRanges(
                                projectRef.current.trim,
                                projectRef.current.clips,
                              )
                            : [];
                        if (a.duration)
                          a.currentTime =
                            sourceToEdited(
                              video.current?.currentTime ?? time,
                              kept,
                            ) % a.duration;
                        a.volume =
                          projectRef.current?.backgroundAudio?.volume ?? 0.25;
                      }}
                    />
                    <audio
                      ref={clickSoundAudio}
                      src={assetURL("mouse-click.wav")}
                      preload="auto"
                      hidden
                    />
                    <canvas
                      className="preview-proxy"
                      ref={qualityCanvas}
                      hidden
                      aria-hidden="true"
                    />
                  </div>
                  <canvas
                    className="motion-preview"
                    ref={motionCanvas}
                    hidden
                    aria-hidden="true"
                  />
                  {currentEffect &&
                    time >= currentEffect.start &&
                    time < currentEffect.end && (
                      <div
                        className={`preview-effect ${currentEffect.kind} ${selectedEffect === currentEffect.id ? "selected" : ""}`}
                        role="button"
                        tabIndex={0}
                        aria-label={
                          currentEffect.kind === "mask"
                            ? "Área desfocada, arraste para mover"
                            : "Área destacada, arraste para mover"
                        }
                        onPointerDown={(e) => dragEffect(e, currentEffect)}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedEffect(currentEffect.id);
                          setSelected(null);
                          setSelectedClip(null);
                          setPanel("effect");
                        }}
                        onKeyDown={(e) => {
                          const dx =
                              e.key === "ArrowLeft"
                                ? -0.01
                                : e.key === "ArrowRight"
                                  ? 0.01
                                  : 0,
                            dy =
                              e.key === "ArrowUp"
                                ? -0.01
                                : e.key === "ArrowDown"
                                  ? 0.01
                                  : 0;
                          if (dx || dy) {
                            e.preventDefault();
                            e.stopPropagation();
                            effectChange({
                              x: clamp(
                                currentEffect.x + dx,
                                currentEffect.width / 2,
                                1 - currentEffect.width / 2,
                              ),
                              y: clamp(
                                currentEffect.y + dy,
                                currentEffect.height / 2,
                                1 - currentEffect.height / 2,
                              ),
                            });
                          }
                        }}
                        style={
                          {
                            left: `${(0.5 + (currentEffect.x - currentEffect.width / 2 - 0.5) / visibleSpanX) * 100}%`,
                            top: `${(0.5 + (currentEffect.y - currentEffect.height / 2 - 0.5) / visibleSpanY) * 100}%`,
                            width: `${(currentEffect.width / visibleSpanX) * 100}%`,
                            height: `${(currentEffect.height / visibleSpanY) * 100}%`,
                            "--effect-opacity": currentEffect.opacity,
                          } as React.CSSProperties
                        }
                      >
                        <span
                          className="effect-resize"
                          role="button"
                          tabIndex={0}
                          aria-label="Redimensionar área"
                          onPointerDown={(e) =>
                            dragEffect(e, currentEffect, "resize")
                          }
                          onKeyDown={(e) => {
                            const dw =
                                e.key === "ArrowLeft"
                                  ? -0.01
                                  : e.key === "ArrowRight"
                                    ? 0.01
                                    : 0,
                              dh =
                                e.key === "ArrowUp"
                                  ? -0.01
                                  : e.key === "ArrowDown"
                                    ? 0.01
                                    : 0;
                            if (dw || dh) {
                              e.preventDefault();
                              e.stopPropagation();
                              effectChange(
                                dw
                                  ? {
                                      width: clamp(
                                        currentEffect.width + dw,
                                        0.04,
                                        1,
                                      ),
                                      x: clamp(
                                        currentEffect.x,
                                        currentEffect.width / 2,
                                        1 - currentEffect.width / 2,
                                      ),
                                    }
                                  : {
                                      height: clamp(
                                        currentEffect.height + dh,
                                        0.04,
                                        1,
                                      ),
                                      y: clamp(
                                        currentEffect.y,
                                        currentEffect.height / 2,
                                        1 - currentEffect.height / 2,
                                      ),
                                    },
                              );
                            }
                          }}
                        />
                      </div>
                    )}
                  {panel === "zoom" && currentZoom && !currentZoom.follow && (
                    <button
                      ref={focusMarker}
                      className="zoom-focus"
                      aria-label="Arrastar foco do zoom"
                      title="Arraste para posicionar o foco; use as setas para ajuste fino"
                      disabled={busy}
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={dragFocus}
                      onKeyDown={(e) => {
                        const dx =
                            e.key === "ArrowLeft"
                              ? -0.01
                              : e.key === "ArrowRight"
                                ? 0.01
                                : 0,
                          dy =
                            e.key === "ArrowUp"
                              ? -0.01
                              : e.key === "ArrowDown"
                                ? 0.01
                                : 0;
                        if (dx || dy) {
                          e.preventDefault();
                          e.stopPropagation();
                          zoomChange({
                            x: clamp(currentZoom.x + dx, 0, 1),
                            y: clamp(currentZoom.y + dy, 0, 1),
                          });
                        }
                      }}
                    />
                  )}
                </div>
                {project?.webcam && (
                  <video
                    ref={webcamVideo}
                    className={`webcam-overlay ${currentWebcam?.shape ?? project.webcam.shape}`}
                    src={convertFileSrc(project.webcam.path)}
                    muted
                    playsInline
                    preload="auto"
                    aria-label="Webcam na gravação; arraste para reposicionar"
                    onPointerDown={dragWebcam}
                    onLoadedMetadata={(e) => {
                      const v = e.currentTarget;
                      if (video.current) {
                        v.currentTime = video.current.currentTime;
                        if (!video.current.paused) void v.play();
                      }
                    }}
                    style={{
                      left: `${(currentWebcam ?? project.webcam).x * size.width}px`,
                      top: `${(currentWebcam ?? project.webcam).y * size.height}px`,
                      width: `${(currentWebcam ?? project.webcam).size * webcamSizeFactor * Math.min(size.width, size.height)}px`,
                      opacity: currentWebcam?.opacity ?? 1,
                      borderRadius: `${(currentWebcam?.shape === "circle" ? 0.5 : currentWebcam?.borderRadius ?? (currentWebcam?.shape === "rounded" ? 0.18 : 0)) * 100}%`,
                      borderWidth: `${((currentWebcam?.border ?? 2) * size.width) / 1000}px`,
                      boxShadow: (currentWebcam?.shadow ?? 35) > 0 ? `0 ${(currentWebcam?.size ?? 0.24) * size.width * 0.025}px ${(currentWebcam?.size ?? 0.24) * size.width * 0.055}px rgba(0,0,0,${((currentWebcam?.shadow ?? 35) / 100) * 0.6})` : "none",
                    }}
                  />
                )}
                <div
                  className="rendered-cursor"
                  ref={cursor}
                  style={{
                    display:
                      canEditCursor && look.cursorSize > 0 ? "block" : "none",
                    ...cursorDimensions(
                      selectedCursor,
                      look.cursorSize,
                      size.width,
                    ),
                  }}
                >
                  <img
                    src={assetURL(selectedCursor.file)}
                    alt=""
                    style={{
                      transform: `translate(${-selectedCursor.hotspotX * 100}%,${-selectedCursor.hotspotY * 100}%)`,
                    }}
                  />
                </div>
                </>
              ) : (
                <div className="empty-preview">
                  <div className="empty-icon">
                    <AppIcon name="record" />
                  </div>
                  <h1>Seu próximo vídeo começa aqui.</h1>
                  <p>
                    Grave sua tela ou abra um vídeo.
                    <br />
                    Dê foco ao que importa, com zooms suaves.
                  </p>
                  <button
                    className="light-button"
                    disabled={!desktop || busy}
                    onClick={() => void importVideo()}
                  >
                    <AppIcon name="folder" />
                    Importar vídeo
                  </button>
                  <span>Processamento local · sem upload</span>
                </div>
              )}
            </div>
            {operation === "recording" ||
            operation === "starting" ||
            operation === "stopping" ? (
              <div className="operation-overlay">
                <span className="red-dot" />
                {recordWebcam && (operation === "recording" || operation === "starting") && (
                  <div
                    className="recording-camera-bubble"
                    style={{ left: `${recordingCameraPosition.x * 100}%`, top: `${recordingCameraPosition.y * 100}%`, width: `${Math.min(size.width, size.height) * 0.24 * (look.aspect === "9:16" ? 0.65 : 1)}px` }}
                    onPointerDown={recordingCameraPointerDown}
                    onPointerMove={recordingCameraPointerMove}
                    onPointerUp={recordingCameraPointerUp}
                    onPointerCancel={recordingCameraPointerUp}
                    aria-label="Prévia da webcam. Arraste para escolher a posição no vídeo."
                    title="Arraste para escolher a posição da webcam no vídeo"
                  >
                    {cameraPreviewFrame ? <img src={cameraPreviewFrame} alt="Sua câmera ao vivo" /> : <span className="recording-camera-placeholder">◉</span>}
                    <span className="recording-camera-label"><i /> Arraste para posicionar</span>
                  </div>
                )}
                <strong>
                  {operation === "recording"
                    ? "Gravando o monitor principal"
                    : operation === "starting"
                      ? "Preparando captura…"
                      : "Finalizando vídeo…"}
                </strong>
                <span className="record-clock">{clock(elapsed)}</span>
                <p>
                  Até 4K · 60 fps · resolução da tela preservada · sem áudio.
                </p>
                <button
                  className="light-button"
                  disabled={operation === "stopping"}
                  onClick={() => void stop()}
                >
                  ■ Parar gravação
                </button>
              </div>
            ) : null}
            {recordWebcam && operation === "idle" && (
              <aside className="camera-live-preview" aria-label="Prévia ao vivo da webcam">
                {cameraPreviewFrame ? <img src={cameraPreviewFrame} alt="Prévia ao vivo da webcam" /> : <div className="camera-preview-placeholder">◉</div>}
                <span className="camera-preview-caption">
                  <i className={`camera-preview-dot${cameraPreviewReady ? " ready" : ""}`} />
                  {cameraPreviewError ? "Câmera bloqueada" : cameraPreviewReady ? "Webcam pronta" : "Aguardando acesso à câmera…"}
                </span>
                {cameraPreviewError && <><p className="camera-preview-error">{cameraPreviewError}</p><button className="camera-preview-settings" onClick={() => void invoke("open_camera_settings")}>Abrir permissão da câmera ↗</button><button className="camera-preview-settings" onClick={() => { setCameraPreviewError(""); void invoke("start_camera_preview").catch((cause) => setCameraPreviewError(String(cause))); }}>Tentar novamente</button></>}
              </aside>
            )}
          </div>
          <div className="transport">
            <span className="timecode">{clock(editedTime)}</span>
            <button
              disabled={!media || busy}
              onClick={() => seek(ranges[0]?.start || 0)}
              aria-label="Voltar ao início"
            >
              |◁
            </button>
            <button
              className="play-button"
              disabled={!media || busy}
              onClick={() => void togglePlay()}
              aria-label={playing ? "Pausar" : "Reproduzir"}
            >
              <AppIcon name={playing ? "pause" : "play"} />
            </button>
            <button
              disabled={!media || busy}
              onClick={() => seek(ranges[ranges.length - 1]?.end || 0)}
              aria-label="Ir ao fim"
            >
              ▷|
            </button>
            <span className="timecode">{clock(duration)}</span>
            <select
              className="speed"
              aria-label="Velocidade da prévia"
              value={rate}
              onChange={(e) => {
                const r = Number(e.target.value);
                setRate(r);
                if (video.current) {
                  const clip = ranges.find(
                    (c) =>
                      video.current!.currentTime >= c.start &&
                      video.current!.currentTime < c.end,
                  );
                  video.current.playbackRate = r * (clip ? clipSpeed(clip) : 1);
                }
              }}
            >
              <option value={0.5}>0.5×</option>
              <option value={1}>1×</option>
              <option value={1.5}>1.5×</option>
              <option value={2}>2×</option>
            </select>
          </div>
        </section>
        <nav className="inspector-tabs" aria-label="Ferramentas do editor">
          {(
            [
              ["background", "Aparência"],
              ["zoom", "Zooms"],
              ["cursor", "Cursor"],
              ["animations", "Animações"],
              ["audio", "Áudio"],
              ["webcam", "Webcam"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className={panel === key ? "active" : ""}
              onClick={() => setPanel(key)}
              title={label}
              aria-label={label}
              aria-pressed={panel === key}
            >
              <AppIcon name={key} />
            </button>
          ))}
        </nav>
        <aside className="inspector" ref={inspector}>
          <fieldset disabled={!project || busy}>
            {panel === "background" && (
              <>
                <div className="panel-title">
                  <h2>Background</h2>
                  <span>Fundo e enquadramento</span>
                </div>
                <h3>Fundo</h3>
                <div
                  className="segmented"
                  role="group"
                  aria-label="Tipo de fundo"
                >
                  <button
                    className={
                      look.backgroundMode === "wallpaper" ? "active" : ""
                    }
                    onClick={() =>
                      appearance({
                        backgroundMode: "wallpaper",
                        wallpaper:
                          look.wallpaper ||
                          assetCatalog.wallpapers.find(
                            (item) => item.group === "macOS",
                          )!.id,
                      })
                    }
                  >
                    Wallpaper
                  </button>
                  <button
                    className={
                      !look.backgroundMode || look.backgroundMode === "gradient"
                        ? "active"
                        : ""
                    }
                    onClick={() => appearance({ backgroundMode: "gradient" })}
                  >
                    Gradiente
                  </button>
                  <button
                    className={look.backgroundMode === "color" ? "active" : ""}
                    onClick={() => appearance({ backgroundMode: "color" })}
                  >
                    Cor
                  </button>
                </div>
                <button
                  className="wide subtle"
                  aria-pressed={look.backgroundMode === "video-blur"}
                  onClick={() =>
                    appearance({
                      backgroundMode: "video-blur",
                      backgroundBlur: look.backgroundBlur || 18,
                      cropFill: false,
                      cropFollowCursor: false,
                    })
                  }
                >
                  ▧ Fundo com vídeo desfocado
                </button>
                {look.backgroundMode === "video-blur" ? (
                  <p className="help">
                    Preserva a gravação inteira e amplia uma cópia desfocada
                    atrás para preencher o formato vertical.
                  </p>
                ) : look.backgroundMode === "wallpaper" ? (
                  <>
                    <select
                      className="asset-group"
                      aria-label="Coleção de wallpapers"
                      value={wallpaperGroup}
                      onChange={(e) => setWallpaperGroup(e.target.value)}
                    >
                      {[
                        ...new Set(
                          assetCatalog.wallpapers.map((item) => item.group),
                        ),
                      ].map((group) => (
                        <option key={group}>{group}</option>
                      ))}
                    </select>
                    <button
                      className="wide subtle random-background"
                      disabled={!assetRoot}
                      onClick={() => {
                        const items = assetCatalog.wallpapers.filter(
                          (item) =>
                            item.group === wallpaperGroup &&
                            item.id !== look.wallpaper,
                        );
                        appearance({
                          wallpaper:
                            items[Math.floor(Math.random() * items.length)].id,
                        });
                      }}
                    >
                      ✧ Escolher wallpaper aleatório
                    </button>
                    <div className="asset-grid wallpaper-grid">
                      {assetRoot &&
                        assetCatalog.wallpapers
                          .filter((item) => item.group === wallpaperGroup)
                          .map((item) => (
                            <button
                              key={item.id}
                              className={
                                look.wallpaper === item.id ? "selected" : ""
                              }
                              title={item.label}
                              aria-label={item.label}
                              aria-pressed={look.wallpaper === item.id}
                              onClick={() => appearance({ wallpaper: item.id })}
                            >
                              <img
                                loading="lazy"
                                src={assetURL(item.thumb)}
                                alt=""
                              />
                            </button>
                          ))}
                    </div>
                  </>
                ) : (
                  <>
                    <button
                      className="wide subtle random-background"
                      onClick={() => {
                        const next =
                          (look.background +
                            1 +
                            Math.floor(
                              Math.random() * (backgrounds.length - 1),
                            )) %
                          backgrounds.length;
                        appearance({ background: next, colors: undefined });
                      }}
                    >
                      ✧ Escolher fundo aleatório
                    </button>
                    <div className="swatches">
                      {backgrounds.map((colors, i) => (
                        <button
                          key={i}
                          className={
                            !look.colors && look.background === i
                              ? "selected"
                              : ""
                          }
                          style={{
                            background: `linear-gradient(135deg,${colors[0]},${colors[1]})`,
                          }}
                          aria-label={`Gradiente ${i + 1}`}
                          aria-pressed={look.background === i}
                          onClick={() =>
                            appearance({ background: i, colors: undefined })
                          }
                        />
                      ))}
                    </div>
                    <div className="color-fields">
                      <label>
                        <input
                          aria-label="Cor principal do fundo"
                          type="color"
                          value={palette[0]}
                          onChange={(e) =>
                            appearance({ colors: [e.target.value, palette[1]] })
                          }
                        />
                        <span>{palette[0].toUpperCase()}</span>
                      </label>
                      {look.backgroundMode !== "color" && (
                        <label>
                          <input
                            aria-label="Segunda cor do gradiente"
                            type="color"
                            value={palette[1]}
                            onChange={(e) =>
                              appearance({
                                colors: [palette[0], e.target.value],
                              })
                            }
                          />
                          <span>{palette[1].toUpperCase()}</span>
                        </label>
                      )}
                    </div>
                  </>
                )}
                <Range
                  label="Desfoque do fundo"
                  min={0}
                  max={30}
                  value={look.backgroundBlur || 0}
                  onChange={(backgroundBlur) => appearance({ backgroundBlur })}
                />
                <div className="section-line" />
                <h3>Enquadramento</h3>
                <Range
                  label="Margem"
                  min={0}
                  max={20}
                  value={look.padding}
                  suffix="%"
                  onChange={(padding) => appearance({ padding })}
                />
                <Range
                  label="Cantos arredondados"
                  min={0}
                  max={40}
                  value={look.radius}
                  onChange={(radius) => appearance({ radius })}
                />
                <Range
                  label="Sombra"
                  min={0}
                  max={100}
                  value={look.shadow}
                  suffix="%"
                  onChange={(shadow) => appearance({ shadow })}
                />
                <button
                  className="wide subtle"
                  onClick={() => {
                    try {
                      localStorage.setItem(
                        "frame-preset",
                        JSON.stringify(look),
                      );
                      setNotice(
                        "Aparência salva como padrão para os próximos vídeos.",
                      );
                    } catch {
                      setError("Não foi possível salvar o preset local.");
                    }
                  }}
                >
                  Salvar como padrão
                </button>
              </>
            )}
            {panel === "zoom" && (
              <>
                <div className="panel-title">
                  <h2>Zooms dinâmicos</h2>
                  <span>
                    {cameraMode === "hybrid"
                      ? "Automático, com edição manual"
                      : cameraMode === "auto"
                        ? "Foco gerado pelas interações"
                        : "Enquadramento manual"}
                  </span>
                </div>
                <div
                  className="segmented camera-modes"
                  role="group"
                  aria-label="Modo de câmera"
                >
                  {(
                    [
                      ["auto", "Auto"],
                      ["manual", "Manual"],
                      ["hybrid", "Híbrido"],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      className={cameraMode === mode ? "active" : ""}
                      aria-pressed={cameraMode === mode}
                      onClick={() => setCameraMode(mode)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="motion-options">
                  <button
                    className={!look.smooth ? "active" : ""}
                    onClick={() => appearance({ smooth: false })}
                  >
                    ◎ Focado
                  </button>
                  <button
                    className={look.smooth ? "active" : ""}
                    onClick={() => appearance({ smooth: true })}
                  >
                    〰 Suave
                  </button>
                </div>
                <button
                  className="wide subtle"
                  disabled={!media?.cursorCaptured}
                  onClick={() => {
                    if (media) {
                      edit((p) => ({
                        ...p,
                        zooms: [
                          ...p.zooms.filter((zoom) => !isAutoZoom(zoom)),
                          ...autoZooms(media.cursor, media.duration),
                        ],
                      }));
                      setSelected(null);
                    }
                  }}
                >
                  Recalcular zooms automáticos
                </button>
                {!media?.cursorCaptured && (
                  <p className="help">
                    Vídeos importados sem eventos de cursor usam zoom manual.
                  </p>
                )}
                <button className="wide subtle" onClick={() => addZoom()}>
                  ＋ Adicionar zoom aqui
                </button>
                {currentZoom ? (
                  <>
                    <div className="section-line" />
                    <h3>Zoom selecionado</h3>
                    <label className="switch-label">
                      Seguir cursor
                      <input
                        type="checkbox"
                        disabled={!media?.cursorCaptured}
                        checked={currentZoom.follow || false}
                        onChange={(e) =>
                          zoomChange({ follow: e.target.checked })
                        }
                      />
                    </label>
                    <label className="switch-label">
                      Zoom instantâneo
                      <input
                        type="checkbox"
                        checked={currentZoom.instant ?? false}
                        onChange={(e) =>
                          zoomChange({ instant: e.target.checked })
                        }
                      />
                    </label>
                    <label className="switch-label">
                      Ativo
                      <input
                        type="checkbox"
                        checked={currentZoom.enabled}
                        onChange={(e) =>
                          zoomChange({ enabled: e.target.checked })
                        }
                      />
                    </label>
                    <Range
                      label="Ampliação"
                      min={1}
                      max={3}
                      step={0.05}
                      value={currentZoom.scale}
                      suffix="×"
                      onChange={(scale) => zoomChange({ scale })}
                    />
                    <Range
                      label="Posição horizontal"
                      min={0}
                      max={1}
                      step={0.01}
                      value={currentZoom.x}
                      onChange={(x) => zoomChange({ x })}
                    />
                    <Range
                      label="Posição vertical"
                      min={0}
                      max={1}
                      step={0.01}
                      value={currentZoom.y}
                      onChange={(y) => zoomChange({ y })}
                    />
                    <div className="time-inputs">
                      <label>
                        Início
                        <input
                          aria-label="Início do zoom"
                          type="number"
                          min={0}
                          max={currentZoom.end - 0.1}
                          step={0.1}
                          value={Number(currentZoom.start.toFixed(2))}
                          onChange={(e) =>
                            zoomChange({
                              start: clamp(
                                Number(e.target.value),
                                0,
                                currentZoom.end - 0.1,
                              ),
                            })
                          }
                        />
                      </label>
                      <label>
                        Fim
                        <input
                          aria-label="Fim do zoom"
                          type="number"
                          min={currentZoom.start + 0.1}
                          max={media?.duration}
                          step={0.1}
                          value={Number(currentZoom.end.toFixed(2))}
                          onChange={(e) =>
                            zoomChange({
                              end: clamp(
                                Number(e.target.value),
                                currentZoom.start + 0.1,
                                media?.duration || 1,
                              ),
                            })
                          }
                        />
                      </label>
                    </div>
                    <p className="help">
                      Clique na prévia para escolher o foco. Os zooms entram e
                      saem suavemente.
                    </p>
                    <button
                      className="wide danger"
                      onClick={() => {
                        edit((p) => ({
                          ...p,
                          zooms: p.zooms.filter((z) => z.id !== selected),
                        }));
                        setSelected(null);
                      }}
                    >
                      Remover zoom
                    </button>
                  </>
                ) : (
                  <p className="help">
                    Selecione um bloco roxo na timeline para ajustar duração,
                    intensidade e foco.
                  </p>
                )}
              </>
            )}
            {panel === "cursor" && (
              <>
                <div className="panel-title">
                  <h2>Cursor</h2>
                  <span>Movimento e visibilidade</span>
                </div>
                {!canEditCursor && (
                  <div className="cursor-unavailable" role="status">
                    <strong>Este vídeo não tem cursor editável</strong>
                    <p>
                      O ponteiro de um MP4 exportado já faz parte da imagem.
                      Abra o projeto .framestudio original ou faça uma nova
                      gravação para trocar o cursor.
                    </p>
                    <button
                      className="wide subtle"
                      onClick={() => void openProject()}
                    >
                      Abrir projeto original
                    </button>
                  </div>
                )}
                <fieldset disabled={!canEditCursor || busy}>
                  <h3>Conjunto de cursores</h3>
                  <div className="cursor-themes">
                    {cursorThemes.map((theme) => (
                      <button
                        key={theme}
                        className={look.cursorTheme === theme ? "selected" : ""}
                        aria-pressed={look.cursorTheme === theme}
                        onClick={() =>
                          appearance({
                            cursorTheme: theme,
                            cursorAsset: undefined,
                          })
                        }
                      >
                        <span className="theme-samples">
                          {["pointer", "pointinghand", "ibeam"].map((kind) => (
                            <img
                              key={kind}
                              src={assetURL(themeCursor(theme, kind).file)}
                              alt=""
                            />
                          ))}
                        </span>
                        <span>
                          {theme === "macos"
                            ? "macOS padrão"
                            : theme === "macos-tahoe"
                              ? "macOS Tahoe"
                              : theme}
                        </span>
                      </button>
                    ))}
                  </div>
                  {!events.some((event) => event.kind) && (
                    <p className="help">
                      Esta gravação antiga não contém os tipos de cursor. O
                      conjunto usa a seta; as trocas de contexto precisam ser
                      registradas durante uma nova gravação.
                    </p>
                  )}
                  <Range
                    label="Tamanho"
                    min={0}
                    max={64}
                    value={look.cursorSize}
                    onChange={(cursorSize) => appearance({ cursorSize })}
                  />
                  <label className="switch-label">
                    Movimento suave
                    <input
                      type="checkbox"
                      checked={cursorSmooth}
                      onChange={(e) =>
                        appearance({
                          cursorSmooth: e.target.checked,
                          cursorMotion: e.target.checked
                            ? "medium"
                            : "original",
                        })
                      }
                    />
                  </label>
                  <p className="help">
                    {media?.cursorCaptured
                      ? "Cursor reconstruído separadamente da gravação. Defina o tamanho como zero para ocultar."
                      : "Este vídeo não tem trilha de cursor. O ponteiro já presente no vídeo não pode ser separado."}
                  </p>
                </fieldset>
              </>
            )}
            {panel === "animations" && (
              <section className="animations-panel" aria-label="Animações">
                <div className="panel-title">
                  <h2>Animações</h2>
                  <span>Movimentos com intenção</span>
                </div>
                <h3 id="screen-animation-label">Animação da tela</h3>
                <div
                  className="motion-options"
                  role="group"
                  aria-labelledby="screen-animation-label"
                >
                  <button
                    className={!look.smooth ? "active" : ""}
                    aria-pressed={!look.smooth}
                    onClick={() => appearance({ smooth: false })}
                  >
                    Focado
                  </button>
                  <button
                    className={look.smooth ? "active" : ""}
                    aria-pressed={look.smooth}
                    onClick={() => appearance({ smooth: true })}
                  >
                    Suave
                  </button>
                </div>
                <p className="help">
                  {look.smooth
                    ? "Transições mais longas e acompanhamento gradual para apresentações."
                    : "A câmera estabiliza mais rápido para facilitar a leitura."}
                </p>
                <div className="section-line" />
                <label className="switch-label">
                  Inércia da câmera
                  <input
                    type="checkbox"
                    checked={look.cameraSpring ?? false}
                    onChange={(e) =>
                      appearance({ cameraSpring: e.target.checked })
                    }
                  />
                </label>
                <h3 id="cursor-animation-label">Animação do cursor</h3>
                <fieldset disabled={!canEditCursor}>
                  <div
                    className="motion-options cursor-motion-options"
                    role="group"
                    aria-labelledby="cursor-animation-label"
                    aria-describedby="cursor-animation-help"
                  >
                    {(
                      [
                        ["original", "Original"],
                        ["smooth", "Suave"],
                        ["medium", "Médio"],
                        ["rapid", "Rápido"],
                      ] as const
                    ).map(([motion, label]) => (
                      <button
                        key={motion}
                        className={cursorMotion === motion ? "active" : ""}
                        aria-pressed={cursorMotion === motion}
                        onClick={() =>
                          appearance({
                            cursorMotion: motion,
                            cursorSmooth: motion !== "original",
                          })
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <p className="help" id="cursor-animation-help">
                  {media && !canEditCursor
                    ? "Este vídeo não tem trilha de cursor. Abra o projeto original ou faça uma nova gravação para animar o ponteiro."
                    : "A suavização preserva a posição dos cliques e funciona independentemente da animação da tela."}
                </p>
                <div className="section-line" />
                <h3>Motion blur</h3>
                <Range
                  label="Movimento do cursor"
                  min={0}
                  max={1}
                  step={0.05}
                  value={look.motionBlur?.cursor ?? 0}
                  onChange={(cursor) =>
                    appearance({
                      motionBlur: {
                        ...(look.motionBlur ?? { cursor: 0, zoom: 0, pan: 0 }),
                        cursor,
                      },
                    })
                  }
                />
                <Range
                  label="Aproximação e afastamento"
                  min={0}
                  max={1}
                  step={0.05}
                  value={look.motionBlur?.zoom ?? 0}
                  onChange={(zoom) =>
                    appearance({
                      motionBlur: {
                        ...(look.motionBlur ?? { cursor: 0, zoom: 0, pan: 0 }),
                        zoom,
                      },
                    })
                  }
                />
                <Range
                  label="Deslocamento da tela"
                  min={0}
                  max={1}
                  step={0.05}
                  value={look.motionBlur?.pan ?? 0}
                  onChange={(pan) =>
                    appearance({
                      motionBlur: {
                        ...(look.motionBlur ?? { cursor: 0, zoom: 0, pan: 0 }),
                        pan,
                      },
                    })
                  }
                />
                <p className="help">
                  A intensidade zero desativa cada efeito. O desfoque acompanha
                  o movimento e aparece também na exportação.
                </p>
              </section>
            )}

            {panel === "webcam" && (
              <>
                <div className="panel-title">
                  <h2>Webcam</h2>
                  <span>Sobreposição na gravação</span>
                </div>
                {project?.webcam ? (
                  <>
                    <p className="help">
                      Arraste a webcam pelo quadro. Os ajustes são independentes
                      para 16:9 e 9:16 e não recebem o zoom da tela.
                    </p>
                    <label className="select-field">
                      Animação
                      <select value={currentWebcam?.mode ?? "static"} onChange={(e) => webcamChange({ mode: e.target.value as WebcamMode })}>
                        <option value="static">Estática</option><option value="manual">Manual por keyframes</option><option value="auto">Automática</option><option value="hybrid">Híbrida</option>
                      </select>
                    </label>
                    <p className="help">Automática e híbrida afastam a webcam do foco central quando há risco de cobrir a área ampliada. Não inferem fala nem reagem a cada clique.</p>
                    {look.aspect === "9:16" && (
                      <button
                        className="wide subtle"
                        onClick={() => {
                          appearance({ cropFill: false, cropFollowCursor: false, padding: 2 });
                          webcamChange({ x: 0.5, y: 0.7, size: 0.6 });
                        }}
                      >
                        Posicionar abaixo da tela
                      </button>
                    )}
                    <button className={`wide subtle ${webcamKeyed ? "camera-key-active" : ""}`} onClick={toggleWebcamKeyframe}>
                      {webcamKeyed ? "◆ Ajuste neste momento · remover" : "◇ Adicionar ajuste neste momento"}
                    </button>
                    <div
                      className="segmented"
                      role="group"
                      aria-label="Formato da webcam"
                    >
                      {(
                        [
                          ["circle", "Redondo"],
                          ["rounded", "Cantos"],
                          ["square", "Quadrado"],
                        ] as const
                      ).map(([shape, label]) => (
                        <button
                          key={shape}
                          className={currentWebcam?.shape === shape ? "active" : ""}
                          aria-pressed={currentWebcam?.shape === shape}
                          onClick={() => webcamChange({ shape })}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <Range
                      label="Tamanho"
                      min={Math.round(8 * webcamSizeFactor)}
                      max={Math.round(60 * webcamSizeFactor)}
                      suffix="%"
                      value={(currentWebcam ?? project.webcam).size * webcamSizeFactor * 100}
                      onChange={(size) => {
                        const camera = currentWebcam;
                        const normalizedSize = size / (100 * webcamSizeFactor);
                        if (camera) webcamChange({ size: normalizedSize, x: clamp(camera.x, normalizedSize / 2, 1 - normalizedSize / 2), y: clamp(camera.y, normalizedSize / 2, 1 - normalizedSize / 2) });
                      }}
                    />
                    <label className="switch-label">Exibir webcam<input type="checkbox" checked={(currentWebcam?.opacity ?? 1) > 0} onChange={(e) => webcamChange({ opacity: e.target.checked ? 1 : 0 })} /></label>
                    <Range label="Opacidade" min={0} max={100} suffix="%" value={Math.round((currentWebcam?.opacity ?? 1) * 100)} onChange={(v) => webcamChange({ opacity: v / 100 })} />
                    <Range label="Borda" min={0} max={8} suffix=" px" value={currentWebcam?.border ?? 2} onChange={(v) => webcamChange({ border: v })} />
                    <Range label="Sombra" min={0} max={100} suffix="%" value={currentWebcam?.shadow ?? 35} onChange={(v) => webcamChange({ shadow: v })} />
                    <h3>Posição</h3>
                    <div className="segmented camera-corners">
                      {([[0.2, 0.2, "↖"], [0.8, 0.2, "↗"], [0.2, 0.8, "↙"], [0.8, 0.8, "↘"]] as const).map(([x, y, label]) => <button key={label} onClick={() => { const camera = currentWebcam; if (camera) webcamChange({ x: clamp(x, camera.size / 2, 1 - camera.size / 2), y: clamp(y, camera.size / 2, 1 - camera.size / 2) }); }}>{label}</button>)}
                    </div>
                    {webcamKeyed && currentWebcam?.mode !== "static" && <>
                      <label className="select-field">Curva da transição<select value={selectedWebcam?.keyframes?.find((key) => Math.abs(key.t - time) < 0.02)?.easing ?? "ease-in-out"} onChange={(e) => webcamChange({ easing: e.target.value as WebcamEasing })}><option value="ease-in-out">Suave · ease in-out</option><option value="ease-out">Desacelerar · ease out</option><option value="linear">Linear</option></select></label>
                      <label className="time-inputs webcam-key-time">Tempo do keyframe<input type="number" min={project.trim.start} max={project.trim.end} step="0.05" value={webcamKeyTimeDraft ?? selectedWebcam?.keyframes?.find((key) => Math.abs(key.t - time) < 0.02)?.t ?? time} onFocus={() => setWebcamKeyTimeDraft(selectedWebcam?.keyframes?.find((key) => Math.abs(key.t - time) < 0.02)?.t ?? time)} onChange={(e) => setWebcamKeyTimeDraft(Number(e.target.value))} onBlur={() => { if (webcamKeyTimeDraft !== null) { retimeWebcamKeyframe(webcamKeyTimeDraft); seek(webcamKeyTimeDraft); setWebcamKeyTimeDraft(null); } }} /></label>
                    </>}
                    <div className="motion-options"><button onClick={() => { if (currentWebcam) setWebcamClipboard({ t: time, x: currentWebcam.x, y: currentWebcam.y, size: currentWebcam.size, opacity: currentWebcam.opacity, borderRadius: currentWebcam.borderRadius, easing: "ease-in-out" }); }}>Copiar estado</button><button disabled={!webcamClipboard} onClick={() => webcamClipboard && webcamChange(webcamClipboard)}>Colar estado</button></div>
                    <button
                      className="wide danger"
                      onClick={() =>
                        edit((p) => ({ ...p, version: 11, webcam: undefined }))
                      }
                    >
                      Remover webcam do vídeo
                    </button>
                    <p className="help">Os marcadores da webcam ficam visíveis na timeline. Entre dois marcadores, posição e tamanho mudam suavemente; a exportação acompanha essa animação.</p>
                  </>
                ) : (
                  <>
                    <label className="switch-label">
                      Gravar com webcam
                      <input
                        type="checkbox"
                        checked={recordWebcam}
                        disabled={!desktop || busy}
                        onChange={(e) => setRecordWebcam(e.target.checked)}
                      />
                    </label>
                    <p className="help">
                      A câmera padrão do Mac será gravada em uma faixa separada
                      para você ajustar o formato e a posição depois.
                    </p>
                  </>
                )}
              </>
            )}
            {panel === "audio" && (
              <>
                <div className="panel-title">
                  <h2>Áudio</h2>
                  <span>Trilha e efeitos sonoros</span>
                </div>
                <h3>Cliques do mouse</h3>
                <label className="switch-label">
                  Reproduzir som nos cliques
                  <input
                    type="checkbox"
                    checked={look.clickSounds !== false}
                    disabled={!canEditCursor || busy}
                    onChange={(e) => appearance({ clickSounds: e.target.checked })}
                  />
                </label>
                {look.clickSounds !== false && (
                  <Range
                    label="Volume dos cliques"
                    min={0}
                    max={100}
                    step={1}
                    suffix="%"
                    value={(look.clickSoundVolume ?? 0.3) * 100}
                    onChange={(value) => setClickSoundVolume(value / 100)}
                  />
                )}
                <p className="help">
                  Os efeitos acompanham os cliques gravados no preview e no vídeo exportado.
                </p>
                <div className="section-line" />
                {project?.backgroundAudio ? (
                  <>
                    <div className="background-audio-file">
                      <AppIcon name="audio" />
                      <span>
                        <strong>
                          {project.backgroundAudio.path.split("/").pop()}
                        </strong>
                        <small>Repetida até o final da edição</small>
                      </span>
                    </div>
                    <Range
                      label="Volume da música"
                      min={0}
                      max={100}
                      step={1}
                      suffix="%"
                      value={project.backgroundAudio.volume * 100}
                      onChange={(value) => setBackgroundVolume(value / 100)}
                    />
                    <button
                      className="wide subtle"
                      onClick={() => void chooseBackgroundAudio()}
                    >
                      Trocar arquivo
                    </button>
                    <button
                      className="wide danger"
                      onClick={() =>
                        edit((p) => ({
                          ...p,
                          version: 6,
                          backgroundAudio: undefined,
                        }))
                      }
                    >
                      Remover música
                    </button>
                  </>
                ) : (
                  <>
                    <p className="help">
                      Adicione uma trilha MP3, M4A, AAC, WAV ou AIFF. Ela será
                      repetida para cobrir toda a edição.
                    </p>
                    <button
                      className="wide subtle"
                      onClick={() => void chooseBackgroundAudio()}
                    >
                      ＋ Adicionar música
                    </button>
                  </>
                )}
                <p className="help">
                  O áudio original do vídeo continua preservado. O volume
                  controla somente a música.
                </p>
              </>
            )}
            {panel === "effect" && (
              <div className="panel-title">
                <h2>
                  {currentEffect?.kind === "mask" ? "Máscara" : "Destaque"}
                </h2>
                <span>Área e duração do efeito</span>
              </div>
            )}
            {panel === "effect" && !currentEffect && (
              <p className="help">
                Selecione uma faixa de máscara ou destaque na timeline.
              </p>
            )}
            {panel === "effect" && currentEffect && (
              <>
                <div
                  className="segmented"
                  role="group"
                  aria-label="Tipo de efeito"
                >
                  <button
                    className={currentEffect.kind === "mask" ? "active" : ""}
                    aria-pressed={currentEffect.kind === "mask"}
                    onClick={() => effectChange({ kind: "mask" })}
                  >
                    Desfocar
                  </button>
                  <button
                    className={
                      currentEffect.kind === "highlight" ? "active" : ""
                    }
                    aria-pressed={currentEffect.kind === "highlight"}
                    onClick={() => effectChange({ kind: "highlight" })}
                  >
                    Destacar
                  </button>
                </div>
                <p className="help">
                  Arraste a área no vídeo para mover e use a alça para
                  redimensionar. A posição fica fixa no quadro enquanto a câmera
                  se move.
                </p>
                <Range
                  label="Largura"
                  min={4}
                  max={100}
                  suffix="%"
                  value={currentEffect.width * 100}
                  onChange={(width) =>
                    effectChange({
                      width: width / 100,
                      x: clamp(currentEffect.x, width / 200, 1 - width / 200),
                    })
                  }
                />
                <Range
                  label="Altura"
                  min={4}
                  max={100}
                  suffix="%"
                  value={currentEffect.height * 100}
                  onChange={(height) =>
                    effectChange({
                      height: height / 100,
                      y: clamp(currentEffect.y, height / 200, 1 - height / 200),
                    })
                  }
                />
                {currentEffect.kind === "highlight" && (
                  <Range
                    label="Opacidade"
                    min={10}
                    max={100}
                    suffix="%"
                    value={currentEffect.opacity * 100}
                    onChange={(opacity) =>
                      effectChange({ opacity: opacity / 100 })
                    }
                  />
                )}
                <div className="time-inputs effect-times">
                  <label>
                    Início
                    <input
                      aria-label="Início do efeito"
                      type="number"
                      min={0}
                      max={currentEffect.end - 0.1}
                      step={0.1}
                      value={Number(currentEffect.start.toFixed(2))}
                      onChange={(e) =>
                        effectChange({
                          start: clamp(
                            Number(e.target.value),
                            0,
                            currentEffect.end - 0.1,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Fim
                    <input
                      aria-label="Fim do efeito"
                      type="number"
                      min={currentEffect.start + 0.1}
                      max={media?.duration}
                      step={0.1}
                      value={Number(currentEffect.end.toFixed(2))}
                      onChange={(e) =>
                        effectChange({
                          end: clamp(
                            Number(e.target.value),
                            currentEffect.start + 0.1,
                            media?.duration || 1,
                          ),
                        })
                      }
                    />
                  </label>
                </div>
                <button
                  className="wide danger"
                  onClick={() => deleteSelection()}
                >
                  Remover efeito
                </button>
              </>
            )}
            {panel === "clip" && (
              <div className="panel-title">
                <h2>
                  {currentClip ? `Trecho ${selectedClip! + 1}` : "Trecho"}
                </h2>
                <span>Velocidade e cursor por trecho</span>
              </div>
            )}
            {panel === "clip" && !currentClip && (
              <p className="help">
                Selecione um trecho dourado na timeline para ajustar a
                velocidade e o cursor.
              </p>
            )}
            {panel === "clip" && currentClip && (
              <>
                <label className="clip-speed">
                  Velocidade
                  <select
                    aria-label="Velocidade do trecho"
                    value={currentClip.speed ?? 1}
                    onChange={(e) =>
                      clipChange({ speed: Number(e.target.value) })
                    }
                  >
                    {[0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4].map((speed) => (
                      <option key={speed} value={speed}>
                        {speed}×
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset disabled={!canEditCursor}>
                  <label className="switch-label">
                    Ocultar cursor neste trecho
                    <input
                      type="checkbox"
                      checked={currentClip.hideCursor ?? false}
                      onChange={(e) =>
                        clipChange({ hideCursor: e.target.checked })
                      }
                    />
                  </label>
                  <label className="switch-label">
                    Movimento original neste trecho
                    <input
                      type="checkbox"
                      checked={currentClip.cursorOriginal ?? false}
                      onChange={(e) =>
                        clipChange({ cursorOriginal: e.target.checked })
                      }
                    />
                  </label>
                </fieldset>
                <p className="help">
                  A velocidade e as opções de cursor são salvas e aplicadas na
                  exportação.
                </p>
              </>
            )}
            {project && (
              <>
                <div className="section-line" />
                <h3>Trecho de exportação</h3>
                <div className="time-inputs">
                  <label>
                    De
                    <input
                      aria-label="Início do trecho"
                      type="number"
                      min={0}
                      max={project.trim.end - 0.1}
                      step={0.1}
                      value={Number(project.trim.start.toFixed(2))}
                      onChange={(e) => {
                        const start = clamp(
                          Number(e.target.value),
                          0,
                          project.trim.end - 0.1,
                        );
                        changeTrim({ ...project.trim, start });
                        seek(start);
                      }}
                    />
                  </label>
                  <label>
                    Até
                    <input
                      aria-label="Fim do trecho"
                      type="number"
                      min={project.trim.start + 0.1}
                      max={media?.duration}
                      step={0.1}
                      value={Number(project.trim.end.toFixed(2))}
                      onChange={(e) =>
                        changeTrim({
                          ...project.trim,
                          end: clamp(
                            Number(e.target.value),
                            project.trim.start + 0.1,
                            media?.duration || 1,
                          ),
                        })
                      }
                    />
                  </label>
                </div>
              </>
            )}
          </fieldset>
        </aside>
      </div>
      <section className="timeline" aria-label="Timeline">
        <div className="timeline-heading">
          <span>
            <AppIcon name="settings" />
            Timeline{" "}
            <span className="timeline-duration">Edição {clock(duration)}</span>
          </span>
          <div className="timeline-actions">
            <button
              disabled={!project || busy}
              onClick={splitAtPlayhead}
              title="Dividir no marcador ⌘B"
            >
              ✂ Dividir
            </button>
            <button
              disabled={!project || busy || !media}
              onClick={() => addEffect("mask")}
              title="Adicionar desfoque no marcador"
            >
              ▧ Desfocar
            </button>
            <button
              disabled={!project || busy || !media}
              onClick={() => addEffect("highlight")}
              title="Adicionar destaque no marcador"
            >
              ✦ Destacar
            </button>
            <button
              disabled={busy || (!selected && selectedClip === null && !selectedEffect && !webcamKeyed)}
              onClick={deleteSelection}
              title="Apagar seleção · Delete"
            >
              ⌫ Apagar{" "}
              {selected ? "zoom" : selectedEffect ? "efeito" : webcamKeyed ? "ajuste webcam" : "trecho"}
            </button>
            <button
              disabled={!project?.zooms.length || busy}
              onClick={() => {
                edit((p) => ({ ...p, zooms: [] }));
                setSelected(null);
              }}
              title="Remover todos os efeitos de zoom"
            >
              Limpar zooms
            </button>
            {project?.clips && (
              <button
                disabled={busy}
                onClick={() => {
                  edit((p) => ({ ...p, clips: undefined }));
                  setSelectedClip(null);
                }}
              >
                Restaurar cortes
              </button>
            )}
          </div>
        </div>
        <div className="ruler">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i}>{clock(((media?.duration || 10) * i) / 6)}</span>
          ))}
        </div>
        <input
          className="seek-range"
          aria-label="Posição da reprodução"
          type="range"
          disabled={!media || busy}
          min={0}
          max={media?.duration || 10}
          step={0.001}
          value={time}
          onInput={(e) => seek(Number(e.currentTarget.value))}
        />
        <div className="tracks">
          <div
            className="playhead"
            style={{ left: `${(100 * time) / (media?.duration || 10)}%` }}
          />
          <div className="clip-lane">
            {project && media ? (
              ranges.map((clip) => (
                <button
                  key={clip.index}
                  className={`clip-track clip-segment ${selectedClip === clip.index ? "selected-clip" : ""}`}
                  disabled={busy}
                  style={{
                    left: `${(100 * clip.start) / media.duration}%`,
                    width: `${(100 * (clip.end - clip.start)) / media.duration}%`,
                  }}
                  aria-pressed={selectedClip === clip.index}
                  onClick={(e) => {
                    setSelectedClip(clip.index);
                    setSelected(null);
                    setSelectedEffect(null);
                    setPanel("clip");
                    const rect = e.currentTarget.getBoundingClientRect();
                    seek(
                      clip.start +
                        clamp((e.clientX - rect.left) / rect.width, 0, 1) *
                          (clip.end - clip.start),
                    );
                  }}
                  title={`${clock(clip.start)} → ${clock(clip.end)} · selecione para apagar`}
                >
                  <span>Trecho {clip.index + 1}</span>
                  <small>
                    {clock((clip.end - clip.start) / clipSpeed(clip))}
                    {clip.speed && clip.speed !== 1 ? ` · ${clip.speed}×` : ""}
                    {clip.hideCursor
                      ? " · cursor oculto"
                      : clip.cursorOriginal
                        ? " · cursor original"
                        : ""}
                  </small>
                </button>
              ))
            ) : (
              <div className="clip-track">Grave ou importe um vídeo</div>
            )}
          </div>
          <div className="audio-track" aria-label="Música de fundo">
            {project?.backgroundAudio && (
              <div
                className="audio-track-block"
                title={project.backgroundAudio.path.split("/").pop()}
              >
                ♫ {project.backgroundAudio.path.split("/").pop()} ·{" "}
                {Math.round(project.backgroundAudio.volume * 100)}%
              </div>
            )}
          </div>
          <div className="effect-track" aria-label="Máscaras e destaques">
            {project?.effects?.map((effect) => (
              <button
                key={effect.id}
                className={`effect-block ${effect.kind} ${selectedEffect === effect.id ? "selected" : ""}`}
                style={{
                  left: `${(100 * effect.start) / (media?.duration || 1)}%`,
                  width: `${(100 * (effect.end - effect.start)) / (media?.duration || 1)}%`,
                }}
                onClick={() => {
                  setSelectedEffect(effect.id);
                  setSelected(null);
                  setSelectedClip(null);
                  setPanel("effect");
                  seek(effect.start);
                }}
                title={`${effect.kind === "mask" ? "Desfoque" : "Destaque"} · ${clock(effect.start)}–${clock(effect.end)}`}
              >
                {effect.kind === "mask" ? "▧" : "✦"}{" "}
                {clock(effect.end - effect.start)}
              </button>
            ))}
            {!project?.effects?.length && (
              <span className="track-placeholder">
                Adicione desfoques ou destaques no marcador
              </span>
            )}
          </div>
          <div className={`webcam-track ${project?.webcam ? "enabled" : "empty"}`} aria-label="Trilha independente da webcam">
            <span className="webcam-track-title">Webcam</span>
            {selectedWebcam?.keyframes?.map((key, index) => (
              <button
                key={`${key.t}-${index}`}
                className={`webcam-keyframe ${Math.abs(key.t - time) < 0.02 ? "active" : ""}`}
                style={{ left: `${100 * key.t / (media?.duration || 1)}%` }}
                onClick={() => {
                  setSelected(null);
                  setSelectedEffect(null);
                  setSelectedClip(null);
                  setPanel("webcam");
                  seek(key.t);
                }}
                title={`Keyframe da webcam ${index + 1} · ${clock(key.t)}`}
                aria-label={`Selecionar movimento da webcam em ${clock(key.t)}`}
                aria-pressed={Math.abs(key.t - time) < 0.02}
              />
            ))}
            {project?.webcam ? (
              <button
                className={`webcam-track-add ${webcamKeyed ? "active" : ""}`}
                disabled={busy}
                onClick={() => {
                  setSelected(null);
                  setSelectedEffect(null);
                  setSelectedClip(null);
                  setPanel("webcam");
                  toggleWebcamKeyframe();
                }}
                title={webcamKeyed ? "Remover o ajuste da webcam no marcador" : "Adicionar keyframe independente da webcam no marcador"}
                aria-label={webcamKeyed ? "Remover ajuste da webcam no marcador" : "Adicionar ajuste da webcam no marcador"}
              >{webcamKeyed ? "−" : "+"}</button>
            ) : (
              <small className="webcam-track-hint">Ative a webcam para editar esta trilha</small>
            )}
            {project?.webcam && !selectedWebcam?.keyframes?.length && <small className="webcam-track-hint">Posição fixa · adicione keyframes no marcador</small>}
          </div>
          <div
            className="zoom-track"
            onClick={(e) => {
              if (e.target !== e.currentTarget || !media) return;
              const rect = e.currentTarget.getBoundingClientRect();
              addZoom(((e.clientX - rect.left) / rect.width) * media.duration);
            }}
          >
            <span className="zoom-track-title">Zoom da tela</span>
            {project?.zooms.map((z) => (
              <button
                key={z.id}
                className={`zoom-block ${isAutoZoom(z) ? "automatic" : "manual"} ${selected === z.id ? "selected" : ""} ${!z.enabled ? "disabled-zoom" : ""}`}
                style={{
                  left: `${(100 * z.start) / (media?.duration || 1)}%`,
                  width: `${(100 * (z.end - z.start)) / (media?.duration || 1)}%`,
                }}
                disabled={busy}
                onPointerDown={(e) => dragZoom(e, z)}
                onClick={() => {
                  const current =
                    projectRef.current?.zooms.find(
                      (item) => item.id === z.id,
                    ) || z;
                  setSelected(z.id);
                  setSelectedClip(null);
                  setSelectedEffect(null);
                  setPanel("zoom");
                  seek(current.start + (current.end - current.start) / 2);
                }}
                title={`${isAutoZoom(z) ? "Zoom automático" : "Zoom manual"} · ${clock(z.start)} → ${clock(z.end)}`}
              >
                <span>⌕ {z.scale.toFixed(2)}×</span>
              </button>
            ))}
            {!project?.zooms.length && (
              <span className="track-placeholder">
                Clique nesta faixa para adicionar um zoom
              </span>
            )}
          </div>
        </div>
      </section>
      <footer className="statusbar" role="status" aria-live="polite">
        <span className={error ? "error-text" : ""}>
          {error ||
            notice ||
            (desktop
              ? "Pronto · processamento local"
              : "Abra o desktop Tauri para importar e gravar.")}
        </span>
        {operation === "exporting" ? (
          <div className="export-progress">
            <progress max={100} value={progress} />
            <span>{progress}%</span>
            <button onClick={() => void stop()}>Cancelar</button>
          </div>
        ) : capturePermissionDenied ? (
          <button onClick={() => void action("open_screen_recording_settings")}>
            Abrir permissões de gravação ↗
          </button>
        ) : (
          <button
            onClick={() => void action("reveal_clip")}
            disabled={!desktop || busy || !media}
          >
            Mostrar no Finder ↗
          </button>
        )}
      </footer>
    </main>
  );
}
