export type WebcamShape = 'circle' | 'rounded' | 'square' | 'rectangle';
type Geometry = { x: number; y: number; size: number; shape: WebcamShape; borderRadius?: number; border?: number; shadow?: number; opacity?: number };
const clamp = (v: number, low: number, high: number) => Math.max(low, Math.min(high, v));
/** Size is the longest edge as a fraction of the final composition's short edge. */
export function webcamFrame(camera: Geometry, canvasWidth: number, canvasHeight: number, sourceAspect = 16 / 9) {
  const shortEdge = Math.min(canvasWidth, canvasHeight), side = shortEdge * camera.size;
  const aspect = camera.shape === 'rectangle' ? clamp(sourceAspect, .25, 4) : 1;
  const width = side * Math.min(1, aspect), height = side / Math.max(1, aspect), margin = shortEdge * .025;
  const cx = clamp(camera.x * canvasWidth, margin + width / 2, canvasWidth - margin - width / 2);
  const cy = clamp(camera.y * canvasHeight, margin + height / 2, canvasHeight - margin - height / 2);
  const radius = Math.min(width, height) * (camera.shape === 'circle' ? .5 : camera.borderRadius ?? (camera.shape === 'square' ? 0 : .18));
  const border = Math.min(Math.min(width, height) * .08, (camera.border ?? 2) * canvasWidth / 1000);
  return { x: cx / canvasWidth, y: cy / canvasHeight, width, height, left: cx - width / 2, top: cy - height / 2, radius, border, side };
}
export function webcamFrameStyle(camera: Geometry, canvasWidth: number, canvasHeight: number, sourceAspect = 16 / 9) {
  const frame = webcamFrame(camera, canvasWidth, canvasHeight, sourceAspect);
  return { left: `${frame.left}px`, top: `${frame.top}px`, width: `${frame.width}px`, height: `${frame.height}px`, borderRadius: `${frame.radius}px`, opacity: camera.opacity ?? 1, boxShadow: (camera.shadow ?? 35) > 0 ? `0 ${frame.side * .025}px ${frame.side * .11}px rgba(0,0,0,${(camera.shadow ?? 35) / 100})` : 'none', borderWidth: `${frame.border}px` };
}

export type WebcamZoomBehavior = 'keep' | 'shrink' | 'grow' | 'custom';
/** Saturation holds the size through Focus/Follow instead of reacting to every click. */
export function webcamZoomSize(size: number, cameraScale: number, behavior: WebcamZoomBehavior = 'keep', customSize = size) {
  const raw = clamp((cameraScale - 1.02) / .33, 0, 1), amount = raw * raw * (3 - 2 * raw);
  const target = behavior === 'shrink' ? size * .65 : behavior === 'grow' ? size * 1.35 : behavior === 'custom' ? customSize : size;
  return clamp(size + (target - size) * amount, .08, .6);
}

/** Deterministic trailing shutter: smooth even screen-camera cuts, including after seeking. */
export function webcamFocusScale(time: number, scaleAt: (time: number) => number, duration = .4) {
  let sum = 0;
  for (let i = 0; i <= 24; i++) sum += clamp(scaleAt(time - duration * i / 24), 1.02, 1.35);
  return sum / 25;
}

export type Webcam = {
  path: string;
  x: number;
  y: number;
  size: number;
  shape: WebcamShape;
  keyframes?: WebcamKeyframe[];
  mode?: WebcamMode;
  easing?: WebcamEasing;
  zoomBehavior?: WebcamZoomBehavior;
  zoomSize?: number;
  transitionDuration?: number;
  opacity?: number;
  border?: number;
  shadow?: number;
  borderRadius?: number;
  layouts?: { portrait?: WebcamLayout; landscape?: WebcamLayout };
};
export type WebcamMode = "static" | "manual" | "auto" | "hybrid";
export type WebcamEasing = "linear" | "ease-in-out" | "ease-out" | "cubic-bezier";
export type WebcamKeyframe = { t: number; x: number; y: number; size: number; opacity?: number; borderRadius?: number; easing?: WebcamEasing };
export type WebcamLayout = { transitionDuration?: number; zoomBehavior?: WebcamZoomBehavior; zoomSize?: number; x: number; y: number; size: number; shape: Webcam["shape"]; opacity: number; border: number; shadow: number; borderRadius: number; mode: WebcamMode; keyframes: WebcamKeyframe[] };

export function webcamAt(camera: Webcam, time: number): Webcam & { opacity: number; borderRadius: number } {
  const mode = camera.mode ?? (camera.keyframes?.length ? "manual" : "static");
  const base = { ...camera, mode, opacity: camera.opacity ?? 1, border: camera.border ?? 2, shadow: camera.shadow ?? 35 };
  if (mode === "static") return { ...base, opacity: base.opacity, borderRadius: camera.borderRadius ?? (camera.shape === "circle" ? 0.5 : camera.shape === "square" ? 0 : 0.18) };
  const keys = camera.keyframes ?? [];
  if (!keys.length) return { ...base, opacity: base.opacity, borderRadius: camera.borderRadius ?? (camera.shape === "circle" ? 0.5 : camera.shape === "square" ? 0 : 0.18) };
  let index = keys.findIndex((key) => key.t >= time);
  if (index < 0) index = keys.length;
  const a = keys[Math.max(0, index - 1)] ?? keys[0], b = keys[Math.min(index, keys.length - 1)] ?? a;
  const raw = index === 0 ? 0 : index >= keys.length ? 1 : clamp((time - a.t) / Math.max(0.0001, b.t - a.t), 0, 1);
  const easing = a.easing ?? "ease-in-out";
  const amount = webcamEase(raw, easing);
  const mix = (from: number | undefined, to: number | undefined, fallback: number) => (from ?? fallback) + ((to ?? fallback) - (from ?? fallback)) * amount;
  return { ...base, x: mix(a.x, b.x, base.x), y: mix(a.y, b.y, base.y), size: mix(a.size, b.size, base.size), opacity: mix(a.opacity, b.opacity, base.opacity), borderRadius: mix(a.borderRadius, b.borderRadius, camera.borderRadius ?? (camera.shape === "circle" ? 0.5 : camera.shape === "square" ? 0 : 0.18)) };
}
export function planWebcamState(state: Webcam & { opacity: number; borderRadius: number }, cameraScale: number, aspect: string) {
  // Explicit manual tracks own size/position; automation never multiplies them.
  if (state.mode !== "static" && state.keyframes?.length) return state;
  state = { ...state, size: webcamZoomSize(state.size, cameraScale, state.zoomBehavior, state.zoomSize) };
  if (state.mode !== "auto" && state.mode !== "hybrid") return state;
  const side = state.size;
  const overlappingFocus = Math.abs(state.x - 0.5) < side / 2 + 0.025 && Math.abs(state.y - 0.5) < side / 2 + 0.025;
  const margin = Math.max(state.size / 2, side / 2 + 0.025);
  const candidates = aspect === "9:16"
    ? [{ x: 1 - margin, y: 1 - margin }, { x: margin, y: 1 - margin }, { x: 1 - margin, y: margin }, { x: margin, y: margin }]
    : [{ x: 1 - margin, y: 1 - margin }, { x: margin, y: 1 - margin }, { x: 1 - margin, y: margin }, { x: margin, y: margin }];
  const target = overlappingFocus ? candidates.reduce((best, candidate) => Math.hypot(candidate.x - 0.5, candidate.y - 0.5) > Math.hypot(best.x - 0.5, best.y - 0.5) ? candidate : best) : { x: state.x, y: state.y };
  const raw = state.mode === "auto" ? clamp((cameraScale - 1.05) / 0.45, 0, 1) : overlappingFocus ? clamp((cameraScale - 1.08) / 0.42, 0, 1) : 0;
  const amount = raw * raw * (3 - 2 * raw);
  return { ...state, x: state.x + (target.x - state.x) * amount, y: state.y + (target.y - state.y) * amount };
}

export function webcamEase(value: number, easing: WebcamEasing) {
  const t = clamp(value, 0, 1);
  if (easing === 'linear') return t;
  if (easing === 'ease-out') return 1 - (1 - t) ** 3;
  if (easing !== 'cubic-bezier' || t === 0 || t === 1) return t * t * (3 - 2 * t);
  let low = 0, high = 1;
  for (let i = 0; i < 24; i++) {
    const u = (low + high) / 2, x = 3 * (1 - u) ** 2 * u * .42 + 3 * (1 - u) * u * u * .58 + u ** 3;
    if (x < t) low = u; else high = u;
  }
  const u = (low + high) / 2;
  return 3 * (1 - u) * u * u + u ** 3;
}
