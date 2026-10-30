export type CaptureKind = "display" | "area" | "window";
export type CaptureSource = {
  kind: "display" | "window";
  id: number;
  label: string;
  width: number;
  height: number;
};
export type CaptureArea = {
  x: number;
  y: number;
  width: number;
  height: number;
};
export type CaptureSources = {
  displays: CaptureSource[];
  windows: CaptureSource[];
};
export type CaptureSelection = {
  source: { kind: CaptureKind; id: number; area?: CaptureArea };
  resolution: number;
  fps: number;
};

export function validCaptureArea(area: CaptureArea, source: CaptureSource) {
  return (
    Object.values(area).every(Number.isFinite) &&
    area.x >= 0 &&
    area.y >= 0 &&
    area.width >= 32 &&
    area.height >= 32 &&
    area.x + area.width <= source.width &&
    area.y + area.height <= source.height
  );
}
