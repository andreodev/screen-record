export type Point = { x: number; y: number };
export type CursorEvent = Point & { t: number; down: boolean };
export type Zoom = Point & { id: string; start: number; end: number; scale: number; enabled: boolean; follow?: boolean };
export type Camera = Point & { scale: number };
export type CameraKey = Camera & { t: number };
export type Appearance = { background: number; padding: number; radius: number; shadow: number; cursorSize: number; smooth: boolean; aspect: string; backgroundMode?: "gradient" | "color" | "wallpaper"; colors?: [string, string]; cursorSmooth?: boolean; wallpaper?: string; cursorAsset?: string; backgroundBlur?: number; cursorMotion?: "original" | "smooth" | "medium" | "rapid"; cameraSpring?: boolean };
export const backgrounds = [
  ["#25243d", "#7c6a9e"], ["#112e3b", "#45a7ac"], ["#512e53", "#eb9a89"],
  ["#182b33", "#538367"], ["#171719", "#35353c"], ["#6b3e81", "#d574ae"],
];
export const defaults: Appearance = { background: 0, padding: 9, radius: 12, shadow: 35, cursorSize: 24, smooth: true, aspect: "auto" };
export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const ease = (n: number) => { const v = clamp(n, 0, 1); return v * v * v * (v * (v * 6 - 15) + 10); };
export function cursorAt(t: number, events: CursorEvent[]): CursorEvent | null {
  if (!events.length) return null;
  let low = 0, high = events.length;
  while (low < high) { const m = (low + high) >>> 1; if (events[m].t <= t) low = m + 1; else high = m; }
  const a = events[Math.max(0, low - 1)], b = events[Math.min(low, events.length - 1)];
  const u = b.t > a.t ? clamp((t - a.t) / (b.t - a.t), 0, 1) : 0;
  // Spatial smoothing is computed once; easing each tiny sample would repeatedly stop the cursor.
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, t, down: a.down };
}
function blendZoom(camera: Camera, z: Zoom, t: number, smooth: boolean): Camera {
  if (!z.enabled || t <= z.start || t >= z.end || z.end <= z.start) return camera;
  const entry = smooth ? .65 : .35, exit = smooth ? .8 : .45;
  const shorten = Math.min(1, (z.end - z.start) / (entry + exit));
  const amount = ease(Math.min((t - z.start) / (entry * shorten), (z.end - t) / (exit * shorten)));
  const targetScale = clamp(z.scale, 1, 3), targetHalf = .5 / targetScale;
  const x = clamp(z.x, targetHalf, 1 - targetHalf), y = clamp(z.y, targetHalf, 1 - targetHalf);
  let scale = camera.scale + (targetScale - camera.scale) * amount;
  // Open the framing during a distant handoff instead of racing across a magnified screen.
  if (camera.scale > 1.01) {
    const travel = Math.hypot(x - camera.x, y - camera.y);
    scale = Math.max(1, 1 / (1 / scale + travel * 4 * amount * (1 - amount)));
  }
  const half = .5 / scale;
  return { scale, x: clamp(camera.x + (x - camera.x) * amount, half, 1 - half), y: clamp(camera.y + (y - camera.y) * amount, half, 1 - half) };
}
export function cameraAt(t: number, zooms: Zoom[], smooth = true): Camera {
  // Later layers take priority gradually, including at overlapping segment boundaries.
  let camera: Camera = { x: .5, y: .5, scale: 1 };
  for (const z of zooms) camera = blendZoom(camera, z, t, smooth);
  return camera;
}
export function autoZooms(events: CursorEvent[], duration: number): Zoom[] {
  const zooms: Zoom[] = [];
  let lastClick = -Infinity;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (!e.down || (i > 0 && events[i - 1].down) || e.t < 0 || e.t > duration) continue;
    const last = zooms[zooms.length - 1];
    if (last && e.t - lastClick < 1.3 && Math.hypot(last.x - e.x, last.y - e.y) < .25) {
      last.end = Math.min(duration, e.t + 1.6);
    } else {
      const start = Math.max(0, e.t - .65), end = Math.min(duration, e.t + 1.6);
      // Keep overlapping handoffs intact; truncation can invert a segment during a burst of clicks.
      if (end - start >= .4) zooms.push({ id: `auto-${zooms.length}`, start, end, x: e.x, y: e.y, scale: 1.65, enabled: true, follow: true });
    }
    lastClick = e.t;
  }
  return zooms;
}
export function cameraKeys(zooms: Zoom[], duration: number, smooth: boolean, events: CursorEvent[] = [], spring = false): CameraKey[] {
  const result: CameraKey[] = [];
  const scheduled = zooms.map((zoom, index) => ({ zoom, index, focus: { x: zoom.x, y: zoom.y } }))
    .filter(({ zoom }) => zoom.enabled && zoom.end > zoom.start).sort((a, b) => a.zoom.start - b.zoom.start);
  let next = 0;
  let active: typeof scheduled = [];
  const alpha = 1 - Math.exp(-1 / (60 * (smooth ? .2 : .1)));
  for (let i = 0; i <= Math.ceil(duration * 60); i++) {
    const t = Math.min(duration, i / 60);
    active = active.filter(item => item.zoom.end >= t);
    let added = false;
    while (next < scheduled.length && scheduled[next].zoom.start <= t) {
      if (scheduled[next].zoom.end >= t) { active.push(scheduled[next]); added = true; }
      next++;
    }
    if (added) active.sort((a, b) => a.index - b.index);
    const point = active.some(item => item.zoom.follow) ? cursorAt(t, events) : null;
    let camera: Camera = { x: .5, y: .5, scale: 1 };
    for (const item of active) {
      let zoom = item.zoom;
      if (zoom.follow && point) {
        const zone = .12 / zoom.scale, dx = point.x - item.focus.x, dy = point.y - item.focus.y;
        item.focus.x += Math.sign(dx) * Math.max(0, Math.abs(dx) - zone) * alpha;
        item.focus.y += Math.sign(dy) * Math.max(0, Math.abs(dy) - zone) * alpha;
        zoom = { ...zoom, ...item.focus };
      }
      camera = blendZoom(camera, zoom, t, smooth);
    }
    result.push({ t, ...camera });
  }
  if (spring) {
    // Integrate damped motion offline, so seeking and native export share identical positions.
    const mass = 2.25, stiffness = smooth ? 170 : 250, damping = smooth ? 36 : 40;
    let value: Camera = { x: .5, y: .5, scale: 1 }, velocity: Camera = { x: 0, y: 0, scale: 0 };
    for (const key of result) {
      for (let sub = 0; sub < 4; sub++) for (const prop of ["x", "y", "scale"] as const) {
        const acceleration = (stiffness * (key[prop] - value[prop]) - damping * velocity[prop]) / mass;
        velocity[prop] += acceleration / 240; value[prop] += velocity[prop] / 240;
      }
      value.scale = clamp(value.scale, 1, 3);
      const half = .5 / value.scale;
      key.x = clamp(value.x, half, 1 - half); key.y = clamp(value.y, half, 1 - half); key.scale = value.scale;
    }
  }
  return result;
}

// Offline smoothing narrows its window near clicks to preserve their exact position.
export function smoothCursor(events: CursorEvent[], windowSeconds = .065): CursorEvent[] {
  const clicks = events.filter((e, i) => e.down && (i === 0 || !events[i - 1].down)).map(e => e.t);
  let click = 0;
  return events.map((e, index) => {
    while (click < clicks.length && clicks[click] < e.t) click++;
    const distance = Math.min(Math.abs(e.t - (clicks[click] ?? Infinity)), Math.abs(e.t - (clicks[click - 1] ?? -Infinity)));
    const radius = Math.min(windowSeconds, distance);
    if (radius < .0001) return e;
    let x = 0, y = 0, weight = 0;
    for (let j = Math.max(0, index - 16); j < Math.min(events.length, index + 17); j++) {
      const w = Math.max(0, 1 - Math.abs(events[j].t - e.t) / radius);
      x += events[j].x * w; y += events[j].y * w; weight += w;
    }
    return { ...e, x: weight ? x / weight : e.x, y: weight ? y / weight : e.y };
  });
}
export function cameraFromKeys(t: number, keys: CameraKey[]): Camera {
  if (!keys.length) return { x: .5, y: .5, scale: 1 };
  let low = 0, high = keys.length;
  while (low < high) { const m = (low + high) >>> 1; if (keys[m].t <= t) low = m + 1; else high = m; }
  const a = keys[Math.max(0, low - 1)], b = keys[Math.min(low, keys.length - 1)];
  const u = b.t > a.t ? clamp((t - a.t) / (b.t - a.t), 0, 1) : 0;
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, scale: a.scale + (b.scale - a.scale) * u };
}
