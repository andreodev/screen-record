export type Clip = { start: number; end: number; speed?: number; hideCursor?: boolean; cursorOriginal?: boolean };
export type Effect = { id: string; kind: "mask" | "highlight" | "text" | "arrow" | "rectangle" | "ellipse" | "spotlight" | "magnifier" | "caption" | "watermark"; text?: string; color?: string; start: number; end: number; x: number; y: number; width: number; height: number; opacity: number };
export const clipSpeed = (clip: Clip) => clip.speed ?? 1;
export function clipRanges(trim: Clip, clips?: Clip[]) {
  return (clips ?? [trim]).map((clip, index) => ({...clip, start: Math.max(trim.start, clip.start), end: Math.min(trim.end, clip.end), index})).filter(clip => clip.end > clip.start);
}
export const editedDuration = (ranges: Clip[]) => ranges.reduce((sum, clip) => sum + (clip.end - clip.start) / clipSpeed(clip), 0);
export function sourceToEdited(time: number, ranges: Clip[]) {
  let elapsed = 0;
  for (const clip of ranges) {
    if (time < clip.start) return elapsed;
    if (time < clip.end) return elapsed + (time - clip.start) / clipSpeed(clip);
    elapsed += (clip.end - clip.start) / clipSpeed(clip);
  }
  return elapsed;
}
export function editedToSource(time: number, ranges: Clip[]) {
  let remaining = Math.max(0, time);
  for (const clip of ranges) {
    const length = (clip.end - clip.start) / clipSpeed(clip);
    if (remaining < length) return clip.start + remaining * clipSpeed(clip);
    remaining -= length;
  }
  return ranges[ranges.length-1]?.end ?? 0;
}
export function splitClip(clips: Clip[], time: number) {
  const index = clips.findIndex(clip => time - clip.start >= .1 - 1e-8 && clip.end - time >= .1 - 1e-8);
  if (index < 0) return null;
  return [...clips.slice(0, index), {...clips[index], end: time}, {...clips[index], start: time}, ...clips.slice(index + 1)];
}
export function formatTime(seconds: number) {
  const ms = Math.max(0, Math.round((Number.isFinite(seconds) ? seconds : 0) * 1000));
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2,'0')}.${String(ms % 1000).padStart(3,'0')}`;
}
