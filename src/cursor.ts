import catalog from './studio-assets.json' with { type: 'json' };
import type { Appearance, CursorEvent } from './zoom.ts';

export const cursorThemes = [...new Set(catalog.cursors.filter(item => item.id.startsWith('sets/')).map(item => item.group))];
export function themeCursor(theme: string, kind = 'pointer') {
  const match = (group: string, role: string) => catalog.cursors.find(item => item.group === group && item.label.startsWith(`${role}-`));
  return match(theme, kind) || match('macos', kind) || match(theme, 'pointer') || match('macos', 'pointer')!;
}
export function cursorImage(appearance: Appearance, event: CursorEvent | null) {
  if (appearance.cursorTheme) return themeCursor(appearance.cursorTheme, event?.kind);
  return catalog.cursors.find(item => item.id === appearance.cursorAsset) || themeCursor('macos', event?.kind);
}
export function cursorDimensions(image: ReturnType<typeof themeCursor>, size: number, sceneWidth: number, zoom = 1) {
  const scale = size * sceneWidth / 1000 * zoom / image.visibleHeight;
  return { width: image.width * scale, height: image.height * scale };
}
