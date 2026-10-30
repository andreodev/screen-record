import { cameraMotionBlur } from "../cinematic";
import { cropPoint } from "../crop";
import { cursorDimensions, cursorImage } from "../cursor";
import { cursorIdleOpacity } from "../cursor-activity";
import { motionFrames } from "../motion";
import type { Camera, CursorEvent } from "../zoom";
import type { Clip } from "../timeline";
import type { Media, Project } from "./types";
import type {
  PreviewRenderData,
  PreviewRendererOptions,
} from "./preview-render-types";

type CanvasOptions = Pick<
  PreviewRendererOptions,
  | "motionCanvas"
  | "video"
  | "videoBackground"
  | "scene"
  | "videoViewport"
  | "plane"
  | "cursor"
  | "qualityCanvas"
  | "motionSample"
  | "cursorImages"
>;
type CanvasFrame = {
  t: number;
  p: Project;
  m: Media;
  data: PreviewRenderData;
  view: { width: number; height: number };
  cam: Camera;
  clip: Clip | undefined;
  cursorEvents: CursorEvent[];
};

export function renderPreviewCanvas(
  {
    motionCanvas,
    video,
    videoBackground,
    scene,
    videoViewport,
    plane,
    cursor,
    qualityCanvas,
    motionSample,
    cursorImages,
  }: CanvasOptions,
  { t, p, m, data, view, cam, clip, cursorEvents }: CanvasFrame,
) {
  const canvas = motionCanvas.current,
    source = video.current;
  const background = videoBackground.current,
    sceneElement = scene.current;
  if (
    background &&
    sceneElement &&
    source &&
    source.readyState >= 2 &&
    p.appearance.backgroundMode === "video-blur"
  ) {
    const density = Math.min(window.devicePixelRatio || 1, 2),
      width = Math.max(1, Math.round(sceneElement.clientWidth * density)),
      height = Math.max(1, Math.round(sceneElement.clientHeight * density));
    if (background.width !== width || background.height !== height) {
      background.width = width;
      background.height = height;
    }
    const context = background.getContext("2d");
    if (context) {
      const crop = data.sourceCrop;
      const sourceWidth = source.videoWidth * crop.width,
        sourceHeight = source.videoHeight * crop.height;
      const sourceAspect = sourceWidth / sourceHeight,
        targetAspect = width / height;
      const sx =
        sourceAspect > targetAspect
          ? (sourceWidth - sourceHeight * targetAspect) / 2
          : 0;
      const sy =
        sourceAspect < targetAspect
          ? (sourceHeight - sourceWidth / targetAspect) / 2
          : 0;
      const sw =
        sourceAspect > targetAspect ? sourceHeight * targetAspect : sourceWidth;
      const sh =
        sourceAspect < targetAspect ? sourceWidth / targetAspect : sourceHeight;
      context.clearRect(0, 0, width, height);
      context.globalAlpha = 0.9;
      context.filter = `blur(${(((p.appearance.backgroundBlur ?? 18) * sceneElement.clientWidth) / 1920) * density}px) brightness(82%)`;
      context.drawImage(
        source,
        sx + crop.x * source.videoWidth,
        sy + crop.y * source.videoHeight,
        sw,
        sh,
        0,
        0,
        width,
        height,
      );
      context.filter = "none";
      context.globalAlpha = 1;
    }
  } else if (background) {
    const context = background.getContext("2d");
    context?.clearRect(0, 0, background.width, background.height);
  }
  const blur = cameraMotionBlur(p.appearance);
  const frames = clip
    ? motionFrames(
        t,
        data.trajectory,
        cursorEvents,
        clip,
        blur,
        data.cameraCuts,
        data.visibleSpanX * data.sourceCrop.width,
        data.visibleSpanY * data.sourceCrop.height,
      )
    : [];
  const enabled =
    frames.length > 1 &&
    !!canvas &&
    !!source &&
    source.readyState >= 2 &&
    !!canvas.getContext("2d");
  if (videoViewport.current)
    videoViewport.current.style.backgroundColor = enabled ? "transparent" : "";
  if (plane.current)
    plane.current.style.visibility = enabled ? "hidden" : "visible";
  // Keep the DOM cursor until this frame actually composites a decoded cursor image.
  if (cursor.current) cursor.current.style.visibility = "visible";
  const proxy = qualityCanvas.current;
  const useProxy = data.quality < 1 && !enabled;
  if (source)
    source.style.visibility = enabled || useProxy ? "hidden" : "visible";
  if (proxy) proxy.hidden = !useProxy;
  if (useProxy && proxy && source && source.readyState >= 2) {
    const density = Math.min(window.devicePixelRatio || 1, 2) * data.quality;
    const width = Math.max(1, Math.round(view.width * density)),
      height = Math.max(1, Math.round(view.height * density));
    if (proxy.width !== width || proxy.height !== height) {
      proxy.width = width;
      proxy.height = height;
    }
    const context = proxy.getContext("2d");
    if (context) {
      context.imageSmoothingQuality = "high";
      context.drawImage(
        source,
        0,
        0,
        source.videoWidth,
        source.videoHeight,
        0,
        0,
        width,
        height,
      );
    }
  }
  if (canvas) canvas.hidden = !enabled;
  if (enabled && canvas && source && source.readyState >= 2 && clip) {
    const density = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(data.sceneWidth * density)),
      height = Math.max(1, Math.round(data.sceneHeight * density));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.setTransform(density, 0, 0, density, 0, 0);
    ctx.beginPath();
    ctx.roundRect(
      data.sceneWidth / 2 - cam.x * view.width * cam.scale,
      data.sceneHeight / 2 - cam.y * view.height * cam.scale,
      view.width * cam.scale,
      view.height * cam.scale,
      Math.min(
        ((p.appearance.radius * data.sceneWidth) / 1000) * cam.scale,
        (Math.min(view.width, view.height) * cam.scale) / 2,
      ),
    );
    ctx.clip();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const sampleCanvas = (motionSample.current ??=
      document.createElement("canvas"));
    if (sampleCanvas.width !== width || sampleCanvas.height !== height) {
      sampleCanvas.width = width;
      sampleCanvas.height = height;
    }
    const sampleCtx = sampleCanvas.getContext("2d");
    if (!sampleCtx) return;
    sampleCtx.imageSmoothingQuality = "high";
    let compositedCursor = false;
    for (const sample of frames) {
      const camera = cropPoint(sample.camera, data.sourceCrop);
      sampleCtx.setTransform(1, 0, 0, 1, 0, 0);
      sampleCtx.clearRect(0, 0, width, height);
      sampleCtx.setTransform(
        density * camera.scale,
        0,
        0,
        density * camera.scale,
        density * (data.sceneWidth / 2 - camera.x * view.width * camera.scale),
        density *
          (data.sceneHeight / 2 - camera.y * view.height * camera.scale),
      );
      sampleCtx.drawImage(
        source,
        source.videoWidth * data.sourceCrop.x,
        source.videoHeight * data.sourceCrop.y,
        source.videoWidth * data.sourceCrop.width,
        source.videoHeight * data.sourceCrop.height,
        0,
        0,
        view.width,
        view.height,
      );
      const desiredEntry = cursorImage(p.appearance, sample.cursor);
      const desiredImage = cursorImages.current.get(desiredEntry.file);
      const fallbackEntry = cursorImage(p.appearance, null);
      const entry =
        desiredImage?.complete && desiredImage.naturalWidth
          ? desiredEntry
          : fallbackEntry;
      const image = cursorImages.current.get(entry.file);
      if (
        sample.cursor &&
        m.cursorCaptured &&
        p.appearance.cursorSize > 0 &&
        image?.complete &&
        image.naturalWidth
      ) {
        const dimensions = cursorDimensions(
          entry,
          p.appearance.cursorSize,
          data.sceneWidth,
          1,
        );
        const point = cropPoint(sample.cursor, data.sourceCrop);
        sampleCtx.globalAlpha = p.appearance.hideIdleCursor
          ? cursorIdleOpacity(t, data.activity)
          : 1;
        sampleCtx.drawImage(
          image,
          point.x * view.width - entry.hotspotX * dimensions.width,
          point.y * view.height - entry.hotspotY * dimensions.height,
          dimensions.width,
          dimensions.height,
        );
        sampleCtx.globalAlpha = 1;
        compositedCursor = true;
      }
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 1 / frames.length;
      ctx.drawImage(sampleCanvas, 0, 0);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    if (cursor.current && compositedCursor)
      cursor.current.style.visibility = "hidden";
  }
}
