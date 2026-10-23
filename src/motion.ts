import { cameraFromKeys, cursorAt, type Appearance, type Camera, type CameraKey, type CursorEvent } from './zoom.ts';
import { clipSpeed, type Clip } from './timeline.ts';

export type MotionFrame = { camera: Camera; cursor: CursorEvent | null };
export function motionFrames(t: number, keys: CameraKey[], events: CursorEvent[], clip: Clip, blur?: Appearance['motionBlur'], cuts: number[] = [], spanX = 1, spanY = 1): MotionFrame[] {
  const current = { camera: cameraFromKeys(t, keys), cursor: clip.hideCursor ? null : cursorAt(t, events) };
  if (!blur || !(blur.cursor || blur.zoom || blur.pan)) return [current];
  let low = 0, high = cuts.length;
  while (low < high) { const m = (low + high) >>> 1; if (cuts[m] <= t) low = m + 1; else high = m; }
  const start = Math.max(clip.start, cuts[low - 1] ?? 0);
  // Fixed shutter in edited time keeps pause, seek and every export fps consistent.
  const past = Math.max(start, t - clipSpeed(clip) / 60);
  const count = Math.max(blur.cursor, blur.zoom, blur.pan) > .5 ? 5 : 3;
  const frames = Array.from({ length: count }, (_, i) => {
    const sample = Math.max(start, t - (t - past) * i / (count - 1));
    const camera = cameraFromKeys(sample, keys), point = current.cursor && cursorAt(sample, events);
    const scale = current.camera.scale + (camera.scale - current.camera.scale) * blur.zoom, halfX = spanX / (2 * scale), halfY = spanY / (2 * scale);
    return {
      camera: {
        x: Math.max(halfX, Math.min(1 - halfX, current.camera.x + (camera.x - current.camera.x) * blur.pan)),
        y: Math.max(halfY, Math.min(1 - halfY, current.camera.y + (camera.y - current.camera.y) * blur.pan)),
        scale,
      },
      cursor: current.cursor && point ? { ...current.cursor, x: current.cursor.x + (point.x - current.cursor.x) * blur.cursor, y: current.cursor.y + (point.y - current.cursor.y) * blur.cursor } : null,
    };
  });
  return frames.every(f => Math.abs(f.camera.x - current.camera.x) * current.camera.scale < .0001 && Math.abs(f.camera.y - current.camera.y) * current.camera.scale < .0001 && Math.abs(f.camera.scale - current.camera.scale) < .0001 && (!f.cursor || !current.cursor || Math.hypot(f.cursor.x - current.cursor.x, f.cursor.y - current.cursor.y) * current.camera.scale < .0001)) ? [current] : frames;
}
