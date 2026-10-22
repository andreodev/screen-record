export type Point = { x: number; y: number };
export type CursorEvent = Point & { t: number; down: boolean; rightDown?: boolean; middleDown?: boolean; kind?: string };
export type Zoom = Point & { id: string; start: number; end: number; scale: number; enabled: boolean; follow?: boolean; instant?: boolean; manualOverride?: boolean; roiWidth?: number; roiHeight?: number };
export type Camera = Point & { scale: number };
export type CameraKey = Camera & { t: number; cut?: boolean };
export type CameraFrame = { left: number; top: number; width: number; height: number };
export type Appearance = { background: number; padding: number; radius: number; shadow: number; cursorSize: number; smooth: boolean; aspect: string; cropFill?: boolean; cropFollowCursor?: boolean; cameraMode?: "auto" | "manual" | "hybrid"; backgroundMode?: "gradient" | "color" | "wallpaper" | "video-blur"; colors?: [string, string]; cursorSmooth?: boolean; wallpaper?: string; cursorAsset?: string; cursorTheme?: string; backgroundBlur?: number; cursorMotion?: "original" | "smooth" | "medium" | "rapid"; cameraSpring?: boolean; motionBlur?: { cursor: number; zoom: number; pan: number } };
export function cursorMotionFor(appearance: Appearance): NonNullable<Appearance["cursorMotion"]> {
  return appearance.cursorMotion ?? (appearance.cursorSmooth === false ? "original" : "medium");
}
export const backgrounds = [
  ["#25243d", "#7c6a9e"], ["#112e3b", "#45a7ac"], ["#512e53", "#eb9a89"],
  ["#182b33", "#538367"], ["#171719", "#35353c"], ["#6b3e81", "#d574ae"],
];
export const defaults: Appearance = { background: 0, padding: 9, radius: 12, shadow: 35, cursorSize: 24, cursorTheme: "macos", smooth: true, aspect: "auto", cameraMode: "hybrid" };
export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
/** Maps the complete recording layer into the final canvas around a source-space focus point. */
export function cameraFrame(camera: Camera, frameWidth: number, frameHeight: number, canvasWidth: number, canvasHeight: number): CameraFrame {
  const width = frameWidth * camera.scale, height = frameHeight * camera.scale;
  return { left: canvasWidth / 2 - camera.x * width, top: canvasHeight / 2 - camera.y * height, width, height };
}
export function cameraViewportTransform(camera: Camera, frameWidth: number, frameHeight: number, canvasWidth: number, canvasHeight: number) {
  const frame = cameraFrame(camera, frameWidth, frameHeight, canvasWidth, canvasHeight);
  return {
    // The viewport is already laid out at the centered base position. CSS
    // transforms are applied from its own top-left, so remove that layout
    // offset once; multiplying it by scale moves the video away from the
    // independently positioned cursor overlay during zooms.
    x: frame.left - (canvasWidth - frameWidth) / 2,
    y: frame.top - (canvasHeight - frameHeight) / 2,
    scale: camera.scale,
  };
}
/** Maps a source-normalized anchor into the output canvas camera coordinates. */
export function cameraPoint(camera: Camera, point: Point, frameWidth: number, frameHeight: number, canvasWidth: number, canvasHeight: number): Point {
  const frame = cameraFrame(camera, frameWidth, frameHeight, canvasWidth, canvasHeight);
  return { x: frame.left + point.x * frame.width, y: frame.top + point.y * frame.height };
}
export function visibleSpans(sourceAspect: number, outputAspect: number, fill: boolean): Point {
  return fill ? { x: Math.min(1, outputAspect / sourceAspect), y: Math.min(1, sourceAspect / outputAspect) } : { x: 1, y: 1 };
}
const ease = (n: number) => { const v = clamp(n, 0, 1); return v * v * v * (v * (v * 6 - 15) + 10); };
const MOBILE_AUTO_SCALE_BIAS = 1.12;
export function cursorAt(t: number, events: CursorEvent[]): CursorEvent | null {
  if (!events.length) return null;
  let low = 0, high = events.length;
  while (low < high) { const m = (low + high) >>> 1; if (events[m].t <= t) low = m + 1; else high = m; }
  const a = events[Math.max(0, low - 1)], b = events[Math.min(low, events.length - 1)];
  const u = b.t > a.t ? clamp((t - a.t) / (b.t - a.t), 0, 1) : 0;
  // Spatial smoothing is computed once; easing each tiny sample would repeatedly stop the cursor.
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, t, down: a.down, rightDown: a.rightDown, middleDown: a.middleDown, kind: a.kind };
}
function blendZoom(camera: Camera, z: Zoom, t: number, smooth: boolean, spanX = 1, spanY = 1): Camera {
  if (!z.enabled || t < z.start || t >= z.end || z.end <= z.start) return camera;
  const entry = smooth ? .65 : .35, exit = smooth ? .8 : .45;
  const shorten = Math.min(1, (z.end - z.start) / (entry + exit));
  const amount = z.instant ? 1 : ease(Math.min((t - z.start) / (entry * shorten), (z.end - t) / (exit * shorten)));
  const targetScale = clamp(z.scale, 1, 3), targetHalfX = spanX / (2 * targetScale), targetHalfY = spanY / (2 * targetScale);
  const x = clamp(z.x, targetHalfX, 1 - targetHalfX), y = clamp(z.y, targetHalfY, 1 - targetHalfY);
  let scale = camera.scale + (targetScale - camera.scale) * amount;
  // Open the framing during a distant handoff instead of racing across a magnified screen.
  if (!z.instant && camera.scale > 1.01) {
    const travel = Math.hypot((x - camera.x) / spanX, (y - camera.y) / spanY);
    scale = Math.max(1, 1 / (1 / scale + travel * 4 * amount * (1 - amount)));
  }
  const halfX = spanX / (2 * scale), halfY = spanY / (2 * scale);
  return { scale, x: clamp(camera.x + (x - camera.x) * amount, halfX, 1 - halfX), y: clamp(camera.y + (y - camera.y) * amount, halfY, 1 - halfY) };
}
export function cameraAt(t: number, zooms: Zoom[], smooth = true): Camera {
  // Later layers take priority gradually, including at overlapping segment boundaries.
  let camera: Camera = { x: .5, y: .5, scale: 1 };
  for (const z of zooms) camera = blendZoom(camera, z, t, smooth);
  return camera;
}
export function autoZooms(events: CursorEvent[], duration: number): Zoom[] {
  const actions: {t:number;x:number;y:number;scale:number}[] = [];
  let lastPressed = false, travel = 0, lastMovement = events[0]?.t ?? 0, lastMovePoint = events[0], lastIntent = -Infinity;
  for (let i = 0; i < events.length; i++) {
    const e = events[i], previous = events[i - 1];
    if (e.t < 0 || e.t > duration) continue;
    const pressed = e.down || !!e.rightDown || !!e.middleDown;
    if (previous) {
      const distance = Math.hypot(e.x - previous.x, e.y - previous.y);
      if (distance > .002) { travel += distance; lastMovement = e.t; lastMovePoint = e; }
    }
    if (pressed && !lastPressed) {
      actions.push({t:e.t,x:e.x,y:e.y,scale:1.65}); lastIntent = e.t; travel = 0;
    } else if (!pressed && travel >= .16 && e.t - lastMovement >= .32 && e.t - lastIntent >= 1.15 && lastMovePoint) {
      actions.push({t:e.t,x:lastMovePoint.x,y:lastMovePoint.y,scale:1.4}); lastIntent = e.t; travel = 0;
    }
    lastPressed = pressed;
  }
  const zooms: Zoom[] = [];
  let previousAction = -Infinity;
  for (const action of actions) {
    const last = zooms[zooms.length - 1];
    if (last && action.t - previousAction < 1.3 && Math.hypot(last.x - action.x, last.y - action.y) < .25) {
      last.end = Math.min(duration, action.t + 1.6); last.follow = true;
    } else {
      if (last && action.t - previousAction < .85) continue;
      const start = Math.max(0, action.t - .65), end = Math.min(duration, action.t + 1.6);
      if (end - start >= .4) zooms.push({ id: `auto-${zooms.length}`, start, end, x: action.x, y: action.y, scale: action.scale, enabled: true, follow: true, roiWidth: .3, roiHeight: .64 });
    }
    previousAction = action.t;
  }
  return zooms;
}
export function isAutoZoom(zoom: Zoom): boolean { return zoom.id.startsWith("auto-") && !zoom.manualOverride; }
export function zoomsForMode(zooms: Zoom[], mode: NonNullable<Appearance["cameraMode"]>): Zoom[] {
  if (mode === "auto") return zooms.filter(isAutoZoom);
  if (mode === "manual") return zooms.filter(zoom => !isAutoZoom(zoom));
  return [...zooms.filter(isAutoZoom), ...zooms.filter(zoom => !isAutoZoom(zoom))];
}
export function cameraKeys(zooms: Zoom[], duration: number, smooth: boolean, events: CursorEvent[] = [], spring = false, spanX = 1, spanY = 1, followCropCursor = false, shake = false, sourceAspect = 16 / 9, outputAspect = sourceAspect): CameraKey[] {
  const result: CameraKey[] = [];
  const instantTimes = new Set<number>();
  const scheduled = zooms.map((zoom, index) => ({ zoom: { ...zoom }, index, focus: { x: zoom.x, y: zoom.y } }))
    .filter(({ zoom }) => zoom.enabled && zoom.end > zoom.start).sort((a, b) => a.zoom.start - b.zoom.start);
  // Bridge short gaps between auto focus blocks. Nearby blocks in one area become a single held scene;
  // a change of area overlaps briefly so the camera pans directly instead of returning to overview.
  for (let i = 1; i < scheduled.length; i++) {
    const previous = scheduled[i - 1]!, current = scheduled[i]!;
    if (!isAutoZoom(previous.zoom) || !isAutoZoom(current.zoom)) continue;
    const gap = current.zoom.start - previous.zoom.end;
    if (gap > 2.5) continue;
    if (Math.hypot(previous.zoom.x - current.zoom.x, previous.zoom.y - current.zoom.y) < .24) {
      previous.zoom.end = Math.max(previous.zoom.end, current.zoom.end);
      previous.zoom.scale = Math.max(previous.zoom.scale, current.zoom.scale);
      current.zoom.enabled = false;
    } else {
      previous.zoom.end = Math.max(previous.zoom.end, current.zoom.start + .55);
    }
  }
  let next = 0;
  let active: typeof scheduled = [];
  let cropX = .5, cropY = .5, previousFrameTime = 0;
  let cameraState: Camera = { x: .5, y: .5, scale: 1 };
  const cuts = new Set(zooms.filter(z => z.enabled && z.instant).flatMap(z => [z.start, z.end]));
  const times = [...new Set([...Array.from({length: Math.ceil(duration * 60) + 1}, (_, i) => Math.min(duration, i / 60)), ...cuts].filter(t => t >= 0 && t <= duration))].sort((a, b) => a - b);
  for (const t of times) {
    active = active.filter(item => item.zoom.end > t && item.zoom.enabled);
    let added = false;
    while (next < scheduled.length && scheduled[next].zoom.start <= t) {
      if (scheduled[next].zoom.enabled && scheduled[next].zoom.end >= t) { active.push(scheduled[next]); added = true; }
      next++;
    }
    if (added) active.sort((a, b) => a.index - b.index);
    const point = active.some(item => item.zoom.follow) ? cursorAt(t, events) : null;
    let target: Camera = { x: .5, y: .5, scale: 1 };
    for (const item of active) {
      let zoom = item.zoom;
      if (zoom.follow && point) {
        const zoneX = .12 * spanX / zoom.scale, zoneY = .12 * spanY / zoom.scale;
        const dx = point.x - item.focus.x, dy = point.y - item.focus.y;
        const followAlpha = 1 - Math.exp(-Math.max(0, t - previousFrameTime) / (smooth ? .2 : .1));
        item.focus.x += Math.sign(dx) * Math.max(0, Math.abs(dx) - zoneX) * followAlpha;
        item.focus.y += Math.sign(dy) * Math.max(0, Math.abs(dy) - zoneY) * followAlpha;
        zoom = { ...zoom, ...item.focus };
      }
      const frameWidth = Math.min(1, sourceAspect / outputAspect);
      const frameHeight = Math.min(1, outputAspect / sourceAspect);
      const roiScale = Math.min(
        .78 / Math.max(.08, frameWidth * (zoom.roiWidth ?? .3)),
        .76 / Math.max(.08, frameHeight * (zoom.roiHeight ?? .64)),
      );
      // Give vertical auto scenes a little more image height so the recording
      // uses more of the canvas while keeping visible headroom around it.
      const mobileScale = clamp(Math.max(roiScale, zoom.scale) * MOBILE_AUTO_SCALE_BIAS, 1, 3);
      // Desktop should retain context; vertical output needs additional scale to counter
      // the landscape frame's letterboxing and make the active ROI readable.
      const scale = isAutoZoom(zoom) ? outputAspect < 1 ? mobileScale : Math.min(1.4, zoom.scale) : clamp(zoom.scale, 1, 3);
      const halfX = spanX / (2 * scale), halfY = spanY / (2 * scale);
      target = { x: clamp(zoom.x, halfX, 1 - halfX), y: clamp(zoom.y, halfY, 1 - halfY), scale };
      if (zoom.instant) cameraState = target;
    }
    if (followCropCursor && (spanX < .999 || spanY < .999)) {
      if (active.length) { cropX = target.x; cropY = target.y; }
      else {
        const point = cursorAt(t, events), dt = t - previousFrameTime;
        const followTarget = (value: number, center: number, span: number) => {
          if (!point || span >= .999) return .5;
          const relative = (value - center) / span + .5;
          return clamp(relative < .38 ? value + span * .12 : relative > .62 ? value - span * .12 : center, span / 2, 1 - span / 2);
        };
        const targetX = followTarget(point?.x ?? .5, cropX, spanX), targetY = followTarget(point?.y ?? .5, cropY, spanY);
        const followAlpha = 1 - Math.exp(-dt / (smooth ? .22 : .11));
        cropX += (targetX - cropX) * followAlpha; cropY += (targetY - cropY) * followAlpha;
        target = { x: cropX, y: cropY, scale: 1 };
      }
    }
    const dt = Math.max(0, t - previousFrameTime);
    const amount = 1 - Math.exp(-dt / (smooth ? .24 : .14));
    if (active.some(item => item.zoom.instant) || cuts.has(t)) cameraState = target;
    else {
      cameraState = {
        x: cameraState.x + (target.x - cameraState.x) * amount,
        y: cameraState.y + (target.y - cameraState.y) * amount,
        scale: cameraState.scale + (target.scale - cameraState.scale) * amount,
      };
    }
    const halfX = spanX / (2 * cameraState.scale), halfY = spanY / (2 * cameraState.scale);
    cameraState.x = clamp(cameraState.x, halfX, 1 - halfX);
    cameraState.y = clamp(cameraState.y, halfY, 1 - halfY);
    previousFrameTime = t;
    if (active.some(item => item.zoom.instant && t < item.zoom.end)) instantTimes.add(t);
    result.push({ t, ...cameraState, ...(cuts.has(t) ? {cut: true} : {}) });
  }
  if (spring) {
    // Integrate damped motion offline, so seeking and native export share identical positions.
    const mass = 2.25, stiffness = smooth ? 170 : 250, damping = smooth ? 36 : 40;
    let value: Camera = { x: .5, y: .5, scale: 1 }, velocity: Camera = { x: 0, y: 0, scale: 0 };
    let previousTime = 0;
    for (const key of result) {
      const dt = key.t - previousTime; previousTime = key.t;
      if (key.cut || instantTimes.has(key.t)) {
        value = { x: key.x, y: key.y, scale: key.scale }; velocity = { x: 0, y: 0, scale: 0 }; continue;
      }
      for (let sub = 0; sub < 4; sub++) for (const prop of ["x", "y", "scale"] as const) {
        const acceleration = (stiffness * (key[prop] - value[prop]) - damping * velocity[prop]) / mass;
        velocity[prop] += acceleration * dt / 4; value[prop] += velocity[prop] * dt / 4;
      }
      value.scale = clamp(value.scale, 1, 3);
      const halfX = spanX / (2 * value.scale), halfY = spanY / (2 * value.scale);
      key.x = clamp(value.x, halfX, 1 - halfX); key.y = clamp(value.y, halfY, 1 - halfY); key.scale = value.scale;
    }
  }
  if (shake) {
    for (let i = 1; i < result.length - 1; i++) {
      const key = result[i], before = result[i - 1], after = result[i + 1];
      if (key.cut || after.cut) continue;
      const movement = clamp(
        Math.abs(after.scale - before.scale) * 18 +
          Math.hypot((after.x - before.x) / spanX, (after.y - before.y) / spanY) * 20,
        0,
        1,
      );
      if (movement < 0.01) continue;
      const halfX = spanX / (2 * key.scale), halfY = spanY / (2 * key.scale);
      key.x = clamp(key.x + Math.sin(key.t * Math.PI * 16) * 0.001 * movement, halfX, 1 - halfX);
      key.y = clamp(key.y + Math.sin(key.t * Math.PI * 18 + 0.7) * 0.0007 * movement, halfY, 1 - halfY);
    }
  }
  return result;
}

// Offline smoothing narrows its window near clicks to preserve their exact position.
export function smoothCursor(events: CursorEvent[], windowSeconds = .065): CursorEvent[] {
  const clicks = events.filter((e, i) => e.down && (i === 0 || !events[i - 1].down)).map(e => e.t);
  let click = 0, first = 0, last = 0;
  return events.map(e => {
    while (click < clicks.length && clicks[click] < e.t) click++;
    const distance = Math.min(Math.abs(e.t - (clicks[click] ?? Infinity)), Math.abs(e.t - (clicks[click - 1] ?? -Infinity)));
    const radius = Math.min(windowSeconds, distance);
    if (radius < .0001) return e;
    let x = 0, y = 0, weight = 0;
    // Use time rather than a sample cap, so high-rate recordings keep the selected profile.
    while (first < events.length && events[first].t < e.t - windowSeconds) first++;
    while (last < events.length && events[last].t <= e.t + windowSeconds) last++;
    for (let j = first; j < last; j++) {
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
  const u = b.t > a.t && !b.cut ? clamp((t - a.t) / (b.t - a.t), 0, 1) : 0;
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, scale: a.scale + (b.scale - a.scale) * u };
}
