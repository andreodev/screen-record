import type { CursorEvent } from './zoom.ts';

export function cursorActivity(events: CursorEvent[]): number[] {
  const times: number[] = [];
  let previous: CursorEvent | undefined;
  for (const point of events) {
    if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= .002 || point.down !== previous.down || point.rightDown !== previous.rightDown || point.middleDown !== previous.middleDown) {
      times.push(point.t); previous = point;
    }
  }
  return times;
}
export function lastTimeAt(time: number, times: number[]): number | undefined {
  let low = 0, high = times.length;
  while (low < high) { const middle = (low + high) >>> 1; if (times[middle] <= time) low = middle + 1; else high = middle; }
  return low ? times[low - 1] : undefined;
}
export function cursorIdleOpacity(time: number, times: number[]): number {
  return Math.max(0, Math.min(1, 1 - (time - (lastTimeAt(time, times) ?? 0) - 1) / .2));
}
