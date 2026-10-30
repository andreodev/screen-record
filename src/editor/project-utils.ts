import { normalizedCrop } from "../crop";
import { defaults, type Appearance } from "../zoom";
import type { Webcam, WebcamLayout } from "../webcam";
import type { Media } from "./types";

export function webcamForAspect(camera: Webcam, aspect: string): Webcam {
  const variant =
    aspect === "9:16"
      ? camera.layouts?.portrait
      : aspect === "16:9"
        ? camera.layouts?.landscape
        : undefined;
  return variant ? { ...camera, ...variant } : camera;
}

export function webcamLayout(camera: Webcam): WebcamLayout {
  return {
    transitionDuration: camera.transitionDuration ?? 0.4,
    zoomBehavior: camera.zoomBehavior ?? "keep",
    zoomSize: camera.zoomSize ?? camera.size,
    x: camera.x,
    y: camera.y,
    size: camera.size,
    shape: camera.shape,
    opacity: camera.opacity ?? 1,
    border: camera.border ?? 2,
    shadow: camera.shadow ?? 35,
    borderRadius:
      camera.borderRadius ??
      (camera.shape === "circle" ? 0.5 : camera.shape === "square" ? 0 : 0.18),
    mode: camera.mode ?? (camera.keyframes?.length ? "manual" : "static"),
    keyframes: camera.keyframes ?? [],
  };
}

export function storedAppearance(): Appearance {
  try {
    const value = JSON.parse(localStorage.getItem("frame-preset") || "null");
    return value && typeof value.padding === "number"
      ? { ...defaults, ...value }
      : defaults;
  } catch {
    return defaults;
  }
}

export function exportDimensions(
  resolution: number,
  aspect: string,
  media?: Media | null,
  crop = normalizedCrop(),
) {
  const ratio =
    aspect === "16:9"
      ? 16 / 9
      : aspect === "9:16"
        ? 9 / 16
        : aspect === "1:1"
          ? 1
          : ((media?.width || 16) * crop.width) /
            ((media?.height || 9) * crop.height);
  const short = resolution;
  const long = (resolution * 16) / 9;
  const maxWidth = ratio >= 1 ? long : short;
  const maxHeight = ratio >= 1 ? short : long;
  const width = Math.max(
    2,
    Math.round(Math.min(maxWidth, maxHeight * ratio) / 2) * 2,
  );
  return `${width} × ${Math.max(2, Math.round(width / ratio / 2) * 2)}`;
}
