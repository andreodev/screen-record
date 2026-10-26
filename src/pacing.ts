import { clipSpeed, type Clip } from './timeline.ts';
import type { CursorEvent } from './zoom.ts';
export type Suggestion = { start: number; end: number; kind: 'silence' | 'typing' };
export type AudioAnalysis = { step: number; levels: number[]; duration: number };

export function silenceSuggestions({ levels, step, duration }: AudioAnalysis): Suggestion[] {
  const result: Suggestion[] = [];
  let start: number | null = null;
  for (let i = 0; i <= levels.length; i++) {
    if (i < levels.length && levels[i] < .0126) { start ??= i * step; continue; }
    if (start !== null) {
      const end = Math.min(duration, i * step);
      if (end - start >= .8) result.push({ kind: 'silence', start: start + .15, end: end - .15 });
      start = null;
    }
  }
  return result;
}
export function typingSuggestions(events: CursorEvent[]): Suggestion[] {
  const result: Suggestion[] = [];
  let start: number | null = null, last = 0;
  function finish() { if (start !== null && last - start >= 1) result.push({ kind: 'typing', start, end: last }); }
  for (const event of events) {
    if (!event.typing) continue;
    if (start === null || event.t - last > 1.5) { finish(); start = event.t; }
    last = event.t;
  }
  finish(); return result;
}
/** Split only the existing edit; removed footage and per-clip settings stay removed/preserved. */
export function applySuggestions(clips: Clip[], suggestions: Suggestion[]): Clip[] {
  let result = clips.map(clip => ({ ...clip }));
  for (const suggestion of suggestions) {
    result = result.flatMap(clip => {
      const start = Math.max(clip.start, suggestion.start), end = Math.min(clip.end, suggestion.end);
      if (end <= start) return [clip];
      return [
        ...(start > clip.start ? [{ ...clip, end: start }] : []),
        ...(suggestion.kind === 'typing' ? [{ ...clip, start, end, speed: Math.max(clipSpeed(clip), 2) }] : []),
        ...(end < clip.end ? [{ ...clip, start: end }] : []),
      ];
    });
  }
  return result;
}
