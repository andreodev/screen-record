export type CropRect = { x: number; y: number; width: number; height: number };
export const fullCrop: CropRect = { x: 0, y: 0, width: 1, height: 1 };
const limit = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function normalizedCrop(value?: CropRect): CropRect {
  if (!value || !Object.values(value).every(Number.isFinite)) return fullCrop;
  const width = limit(value.width, .01, 1), height = limit(value.height, .01, 1);
  return { x: limit(value.x, 0, 1 - width), y: limit(value.y, 0, 1 - height), width, height };
}
export function cropPoint<T extends { x: number; y: number }>(point: T, crop: CropRect): T {
  return { ...point, x: (point.x - crop.x) / crop.width, y: (point.y - crop.y) / crop.height };
}
export function sourcePoint<T extends { x: number; y: number }>(point: T, crop: CropRect): T {
  return { ...point, x: crop.x + point.x * crop.width, y: crop.y + point.y * crop.height };
}

/** Resize from the original rectangle so dragging never accumulates rounding errors. */
export function dragCrop(crop: CropRect, handle: string, dx: number, dy: number, minWidth = .02, minHeight = .02): CropRect {
  if (handle === 'move') return { ...crop, x: limit(crop.x + dx, 0, 1 - crop.width), y: limit(crop.y + dy, 0, 1 - crop.height) };
  let left = crop.x, top = crop.y, right = left + crop.width, bottom = top + crop.height;
  if (handle.includes('w')) left = limit(left + dx, 0, right - minWidth);
  if (handle.includes('e')) right = limit(right + dx, left + minWidth, 1);
  if (handle.includes('n')) top = limit(top + dy, 0, bottom - minHeight);
  if (handle.includes('s')) bottom = limit(bottom + dy, top + minHeight, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}
