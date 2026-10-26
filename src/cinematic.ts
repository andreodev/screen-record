import { cameraFromKeys, clamp, cursorAnchors, type Appearance, type CameraKey, type CursorEvent } from './zoom.ts';
export type CursorResponse = { style: 'off' | 'smooth' | 'cinematic' | 'dynamic'; intensity: number; directionImpact: boolean };
export const cursorResponsePresets = {
  off: { amplitude: 0, duration: .09, frequency: 10 },
  smooth: { amplitude: .0015, duration: .09, frequency: 10 },
  cinematic: { amplitude: .0025, duration: .12, frequency: 11 },
  dynamic: { amplitude: .0035, duration: .15, frequency: 12 },
};
export function cursorResponseFor(look: Appearance): CursorResponse {
  return look.cursorResponse ?? { style: 'off', intensity: 1, directionImpact: true };
}

/** Bake source coordinates once; native renderers interpolate this same track. */
export function responsiveCursor(events: CursorEvent[], keys: CameraKey[], response: CursorResponse, frameWidth = 1, frameHeight = 1): CursorEvent[] {
  const preset = cursorResponsePresets[response.style];
  if (!preset.amplitude || response.intensity <= 0 || !events.length || frameWidth <= 0 || frameHeight <= 0) return events;
  const anchors = cursorAnchors(events);
  let anchor = 0, first = 0, energy = 0, lastMove = -Infinity, lastImpact = -Infinity, travel = 0;
  let directionX = 0, directionY = 0, previousVX = 0, previousVY = 0;
  return events.map((event, i) => {
    const previous = events[i - 1] ?? event, dt = Math.max(0, event.t - previous.t);
    const cam = cameraFromKeys(event.t, keys), wx = frameWidth * cam.scale, wy = frameHeight * cam.scale;
    const stepX = (event.x - previous.x) * wx, stepY = (event.y - previous.y) * wy;
    if (Math.hypot(stepX, stepY) > .00002) lastMove = event.t;
    while (first < i && events[first + 1].t <= event.t - .04) first++;
    const elapsed = event.t - events[first].t;
    const vx = elapsed > 0 ? (event.x - events[first].x) * wx / elapsed : 0;
    const vy = elapsed > 0 ? (event.y - events[first].y) * wy / elapsed : 0;
    const speed = Math.hypot(vx, vy), acceleration = dt > 0 ? Math.hypot(vx - previousVX, vy - previousVY) / dt : 0;
    previousVX = vx; previousVY = vy;
    const moving = event.t - lastMove < .04;
    const target = moving ? clamp((speed - .08) / .35, 0, 1) : 0;
    energy += (target - energy) * (1 - Math.exp(-dt / .025));
    if (event.t - lastMove >= .12) energy = 0;
    if (speed > .08 && moving) {
      const nx = vx / speed, ny = vy / speed;
      if (response.directionImpact && nx * directionX + ny * directionY < -.25 && travel > .025 && event.t - lastImpact >= .45) {
        lastImpact = event.t; travel = 0;
      }
      travel += Math.hypot(stepX, stepY);
      directionX = nx; directionY = ny;
    }
    while (anchor < anchors.length && anchors[anchor] < event.t) anchor++;
    const clickDistance = Math.min(Math.abs(event.t - (anchors[anchor] ?? Infinity)), Math.abs(event.t - (anchors[anchor - 1] ?? -Infinity)));
    const clickFade = clamp(clickDistance / .04, 0, 1);
    const phase = 2 * Math.PI * preset.frequency * event.t;
    const age = event.t - lastImpact, duration = Math.min(.14, preset.duration);
    const impact = age > 0 && age < duration ? Math.sin(Math.PI * age / duration) * (1 - age / duration) * clamp(1 - (event.t - lastMove) / .12, 0, 1) : 0;
    const amplitude = preset.amplitude * clamp(response.intensity, 0, 1) * clickFade;
    const along = Math.sin(phase) * .72 * energy + impact * .25;
    const across = Math.sin(phase * .73 + .7) * .18 * energy;
    const gain = .85 + .15 * clamp(acceleration / 8, 0, 1);
    let dx = (directionX * along - directionY * across) * amplitude * gain;
    let dy = (directionY * along + directionX * across) * amplitude * gain;
    const edgeX = Math.min(event.x, 1 - event.x, .5 / wx - Math.abs(event.x - cam.x)) * wx;
    const edgeY = Math.min(event.y, 1 - event.y, .5 / wy - Math.abs(event.y - cam.y)) * wy;
    const edgeFade = clamp(Math.min(edgeX, edgeY) / .04, 0, 1);
    const length = Math.hypot(dx, dy), limit = amplitude * edgeFade;
    const factor = length > 0 ? Math.min(edgeFade, limit / length) : 0;
    dx *= factor; dy *= factor;
    return { ...event, x: clamp(event.x + dx / wx, 0, 1), y: clamp(event.y + dy / wy, 0, 1) };
  });
}
export type CameraMotion = {
  style: 'smooth' | 'cinematic' | 'dynamic';
  shake: boolean; webcamShake?: boolean; intensity: number; duration: number; frequency: number;
  spring: boolean; damping: number; blur: boolean; blurIntensity: number; impacts?: number[];
};
export const motionPresets: Record<CameraMotion['style'], CameraMotion> = {
  smooth: { style: 'smooth', shake: false, intensity: .001, duration: .12, frequency: 12, spring: true, damping: 1.05, blur: false, blurIntensity: .15 },
  cinematic: { style: 'cinematic', shake: true, intensity: .0018, duration: .14, frequency: 12, spring: true, damping: .95, blur: true, blurIntensity: .18 },
  dynamic: { style: 'dynamic', shake: true, intensity: .0032, duration: .17, frequency: 10, spring: true, damping: .85, blur: true, blurIntensity: .3 },
};
export function cameraMotionFor(look: Appearance): CameraMotion {
  return look.cameraMotion ?? { ...motionPresets.cinematic, spring: look.cameraSpring ?? true };
}
export function cameraMotionBlur(look: Appearance): NonNullable<Appearance['motionBlur']> {
  const settings = cameraMotionFor(look), blur = look.motionBlur;
  return { cursor: blur?.cursor ?? 0, zoom: settings.blur ? Math.min(.5, settings.blurIntensity * (blur?.zoom ?? 1)) : 0, pan: settings.blur ? Math.min(.5, settings.blurIntensity * (blur?.pan ?? 1)) : 0 };
}
/** Detect actual motion episodes, never clicks. Refractory spacing prevents stacked impacts. */
export function motionImpacts(keys: CameraKey[], manual: number[] = []) {
  const automatic: number[] = [];
  let previousSpeed = 0, active = false, travel = 0, previousDX = 0, previousDY = 0;
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i], dt = b.t - a.t;
    if (dt <= 0 || b.cut) { active = false; previousSpeed = 0; travel = 0; continue; }
    const dx = (b.x - a.x) * b.scale, dy = (b.y - a.y) * b.scale;
    const distance = Math.abs(Math.log(b.scale / a.scale)) + Math.hypot(dx, dy), speed = distance / dt;
    const reversed = dx * previousDX + dy * previousDY < -0.00001 && speed > .35 && travel > .1;
    if (speed > .2 && !active) { automatic.push(b.t); active = true; travel = 0; }
    else if (active && speed < .06 && previousSpeed >= .06 && travel > .08) { automatic.push(b.t); active = false; travel = 0; }
    else if (active && reversed) { automatic.push(b.t); travel = 0; }
    travel += distance; previousSpeed = speed; previousDX = dx; previousDY = dy;
  }
  // A manual accent takes priority over a nearby automatic one.
  const result: number[] = [];
  for (const t of [...automatic.filter(t => manual.every(m => Math.abs(t - m) >= .45)), ...manual].sort((a,b) => a-b)) {
    if (!result.length || t - result[result.length - 1] >= .45) result.push(t);
  }
  return result;
}
/** Post-process a COPY of the planned camera; coordinates are canvas-relative, not source pixels. */
export function cinematicKeys(keys: CameraKey[], options: CameraMotion, frameWidth = 1, frameHeight = 1): CameraKey[] {
  if (!options.shake || options.intensity <= 0) return keys;
  const impacts = motionImpacts(keys, options.impacts), result: CameraKey[] = [];
  let index = -1, lastCut = -Infinity;
  for (const key of keys) {
    while (index + 1 < impacts.length && impacts[index + 1] <= key.t) index++;
    if (key.cut) lastCut = key.t;
    const event = impacts[index] ?? -Infinity;
    if (event < lastCut || key.cut) { result.push({ ...key }); continue; }
    const offset = impactOffset(key.t, event, options);
    const dx = offset.x / (frameWidth * key.scale), dy = offset.y / (frameHeight * key.scale);
    const safe = (value: number, delta: number, renderedSize: number) => {
      const edge = .5 / renderedSize;
      const low = renderedSize < 1 ? 1 - edge : edge, high = renderedSize < 1 ? edge : 1 - edge;
      // Preserve intentional padded framing; never "correct" the planned composition.
      return clamp(value + delta, Math.min(value, low), Math.max(value, high));
    };
    result.push({ ...key, x: safe(key.x, dx, frameWidth * key.scale), y: safe(key.y, dy, frameHeight * key.scale) });
  }
  return result;
}

export function impactOffset(time: number, event: number, options: CameraMotion) {
  const age = time - event, u = age / options.duration;
  if (u <= 0 || u >= 1) return { x: 0, y: 0 };
  const envelope = Math.min(1, 2 * Math.sin(Math.PI * u) ** 2 * (1 - u)), phase = 2 * Math.PI * options.frequency * age;
  return { x: options.intensity * envelope * Math.sin(phase), y: options.intensity * .65 * envelope * Math.sin(phase * .85 + .7) };
}
export function webcamMotionState<T extends {x:number;y:number}>(state:T,time:number,options:CameraMotion,events:number[]):T {
  if (!options.webcamShake) return state;
  let low=0,high=events.length;
  while(low<high){const m=(low+high)>>>1;if(events[m]<=time)low=m+1;else high=m;}
  const offset=impactOffset(time,events[low-1]??-Infinity,options);
  return {...state,x:clamp(state.x+offset.x,0,1),y:clamp(state.y+offset.y,0,1)};
}
