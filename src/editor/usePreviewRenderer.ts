import { convertFileSrc } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef } from "react";
import { assetPath } from "../asset-path";
import { cameraMotionFor, webcamMotionState } from "../cinematic";
import { cropPoint } from "../crop";
import { cursorDimensions, cursorImage } from "../cursor";
import { cursorIdleOpacity, lastTimeAt } from "../cursor-activity";
import { clipSpeed, sourceToEdited } from "../timeline";
import {
  cameraFromKeys,
  cameraViewportTransform,
  clamp,
  cursorAt,
  type CursorEvent,
} from "../zoom";
import {
  planWebcamState,
  webcamAt,
  webcamFocusScale,
  webcamFrame,
  webcamFrameStyle,
} from "../webcam";
import { webcamForAspect } from "./project-utils";

import type {
  PreviewRendererOptions,
  PreviewRenderData,
} from "./preview-render-types";
import { renderPreviewCanvas } from "./renderPreviewCanvas";

export function usePreviewRenderer(options: PreviewRendererOptions) {
  const {
    trajectory,
    impactTimes,
    events,
    clickTimes,
    activity,
    assetRoot,
    sourceCrop,
    ranges,
    cameraCuts,
    currentZoom,
    visibleSpanX,
    visibleSpanY,
    size,
    previewQuality,
    viewportRef,
    vw,
    vh,
    projectRef,
    mediaRef,
    webcamContainer,
    webcamVisual,
    webcamVideo,
    scene,
    video,
    lastClickSoundTime,
    playingRef,
    clickSoundAudio,
    videoViewport,
    plane,
    cursor,
    clickRing,
    focusMarker,
    cursorImages,
    motionCanvas,
    videoBackground,
    qualityCanvas,
    motionSample,
    look,
    time,
    project,
    selected,
    panel,
    playing,
    setTime,
    setPlaying,
    rate,
    microphoneAudio,
    audio,
  } = options;
  const renderData = useRef<PreviewRenderData>({
    trajectory,
    impactTimes,
    events,
    clickTimes,
    activity,
    assetRoot,
    sourceCrop,
    ranges,
    cameraCuts,
    currentZoom,
    visibleSpanX,
    visibleSpanY,
    sceneWidth: size.width,
    sceneHeight: size.height,
    quality: previewQuality,
  });
  renderData.current = {
    trajectory,
    impactTimes,
    events,
    clickTimes,
    activity,
    assetRoot,
    sourceCrop,
    ranges,
    cameraCuts,
    currentZoom,
    visibleSpanX,
    visibleSpanY,
    sceneWidth: size.width,
    sceneHeight: size.height,
    quality: previewQuality,
  };
  viewportRef.current = { width: vw, height: vh };
  const draw = useCallback((t: number) => {
    const p = projectRef.current,
      m = mediaRef.current;
    if (!p || !m) return;
    const data = renderData.current,
      cam = cropPoint(cameraFromKeys(t, data.trajectory), data.sourceCrop),
      view = viewportRef.current;
    const fullWidth = view.width / data.sourceCrop.width,
      fullHeight = view.height / data.sourceCrop.height;
    if (p.webcam && webcamContainer.current && webcamVisual.current) {
      const camera = webcamForAspect(p.webcam, p.appearance.aspect);
      const state = webcamMotionState(
        planWebcamState(
          webcamAt(camera, t),
          webcamFocusScale(
            t,
            (at) => cameraFromKeys(at, data.trajectory).scale,
            camera.transitionDuration,
          ),
          p.appearance.aspect,
        ),
        t,
        cameraMotionFor(p.appearance),
        data.impactTimes,
      );
      const facecam = webcamVideo.current;
      const aspect = facecam?.videoHeight
        ? facecam.videoWidth / facecam.videoHeight
        : 16 / 9;
      const frame = webcamFrame(
        state,
        data.sceneWidth,
        data.sceneHeight,
        aspect,
      );
      Object.assign(webcamContainer.current.style, {
        left: `${frame.left}px`,
        top: `${frame.top}px`,
        width: `${frame.width}px`,
        height: `${frame.height}px`,
        borderRadius: `${frame.radius}px`,
      });
      const style = webcamFrameStyle(
        state,
        data.sceneWidth,
        data.sceneHeight,
        aspect,
      );
      Object.assign(webcamVisual.current.style, {
        borderRadius: style.borderRadius,
        borderWidth: style.borderWidth,
        boxShadow: style.boxShadow,
        opacity: String(style.opacity),
      });
    }
    scene.current
      ?.querySelectorAll<HTMLElement>("[data-effect-start]")
      .forEach((element) => {
        const active =
          t >= Number(element.dataset.effectStart) &&
          t < Number(element.dataset.effectEnd);
        element.hidden = !active;
        element.style.setProperty(
          "--mask-blur",
          `${(24 * data.sceneWidth) / 1920 / cam.scale}px`,
        );
        element.style.borderRadius = `${(8 * data.sceneWidth) / 1920}px`;
        const loupe = element.querySelector("canvas"),
          source = video.current;
        const effect = p.effects?.find(
          (item) => item.id === element.dataset.effectId,
        );
        if (active && loupe && source && source.readyState >= 2 && effect) {
          const width = Math.max(16, Math.round(effect.width * fullWidth * 2)),
            height = Math.max(16, Math.round(effect.height * fullHeight * 2));
          if (loupe.width !== width) loupe.width = width;
          if (loupe.height !== height) loupe.height = height;
          const sw = (source.videoWidth * effect.width) / 2,
            sh = (source.videoHeight * effect.height) / 2;
          loupe
            .getContext("2d")
            ?.drawImage(
              source,
              source.videoWidth * effect.x - sw / 2,
              source.videoHeight * effect.y - sh / 2,
              sw,
              sh,
              0,
              0,
              loupe.width,
              loupe.height,
            );
        }
      });
    const previousSoundTime = lastClickSoundTime.current;
    if (
      playingRef.current &&
      p.appearance.clickSounds !== false &&
      previousSoundTime !== null &&
      t >= previousSoundTime
    ) {
      const volume = clamp(p.appearance.clickSoundVolume ?? 0.3, 0, 1);
      if (volume > 0) {
        for (const clickTime of data.clickTimes) {
          if (clickTime <= previousSoundTime || clickTime > t) continue;
          if (
            !data.ranges.some(
              (range) => clickTime >= range.start && clickTime < range.end,
            )
          )
            continue;
          const base = clickSoundAudio.current;
          if (!base) continue;
          const sound = base.cloneNode(true) as HTMLAudioElement;
          sound.volume = volume;
          sound.addEventListener("ended", () => sound.remove(), { once: true });
          void sound.play().catch(() => sound.remove());
        }
      }
    }
    lastClickSoundTime.current = t;
    if (videoViewport.current) {
      const transform = cameraViewportTransform(
        cam,
        view.width,
        view.height,
        data.sceneWidth,
        data.sceneHeight,
      );
      videoViewport.current.style.transformOrigin = "top left";
      videoViewport.current.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`;
    }
    if (plane.current) plane.current.style.transform = "none";
    const clip =
      renderData.current.ranges.find(
        (clip) => t >= clip.start && t < clip.end,
      ) ?? renderData.current.ranges[renderData.current.ranges.length - 1];
    const cursorEvents = clip?.cursorOriginal
      ? m.cursor
      : renderData.current.events;
    const point = cursorAt(t, cursorEvents);
    if (cursor.current)
      cursor.current.style.display =
        point &&
        !clip?.hideCursor &&
        m.cursorCaptured &&
        p.appearance.cursorSize > 0
          ? "block"
          : "none";
    if (cursor.current)
      cursor.current.style.opacity = String(
        p.appearance.hideIdleCursor ? cursorIdleOpacity(t, data.activity) : 1,
      );
    if (clickRing.current) {
      const last = lastTimeAt(t, data.clickTimes),
        age = last === undefined ? 1 : (t - last) / 0.35;
      const point = last === undefined ? null : cursorAt(last, m.cursor);
      const enabled =
        point &&
        age < 1 &&
        !clip?.hideCursor &&
        p.appearance.cursorSize > 0 &&
        p.appearance.clickEffect &&
        p.appearance.clickEffect !== "none";
      clickRing.current.hidden = !enabled;
      if (enabled) {
        const position = { x: point.x * fullWidth, y: point.y * fullHeight };
        const radius =
          ((p.appearance.cursorSize * data.sceneWidth) / 1920) *
          (p.appearance.clickEffect === "ripple" ? 0.7 + age * 1.5 : 1);
        Object.assign(clickRing.current.style, {
          left: `${position.x}px`,
          top: `${position.y}px`,
          width: `${radius * 2}px`,
          height: `${radius * 2}px`,
          opacity: String((1 - age) * 0.65),
          background:
            p.appearance.clickEffect === "circle" ? "#ad91ff" : "transparent",
          borderWidth: `${(2 * data.sceneWidth) / 1920}px`,
        });
      }
    }
    const focus = renderData.current.currentZoom;
    if (focusMarker.current && focus) {
      focusMarker.current.style.left = `${focus.x * fullWidth}px`;
      focusMarker.current.style.top = `${focus.y * fullHeight}px`;
    }
    if (cursor.current && point) {
      const cursorPosition = {
        x: point.x * fullWidth,
        y: point.y * fullHeight,
      };
      cursor.current.style.left = `${cursorPosition.x}px`;
      cursor.current.style.top = `${cursorPosition.y}px`;
      const desired = cursorImage(p.appearance, point);
      const decoded = cursorImages.current.get(desired.file);
      const entry =
        decoded?.complete && decoded.naturalWidth
          ? desired
          : cursorImage(p.appearance, null);
      const image = cursor.current.querySelector("img");
      const dimensions = cursorDimensions(
        entry,
        p.appearance.cursorSize,
        scene.current?.clientWidth || 700,
        1,
      );
      cursor.current.style.width = `${dimensions.width}px`;
      cursor.current.style.height = `${dimensions.height}px`;
      if (image) {
        const src = renderData.current.assetRoot
          ? convertFileSrc(assetPath(renderData.current.assetRoot, entry.file))
          : "";
        if (image.getAttribute("src") !== src) image.setAttribute("src", src);
        image.style.transform = `translate(${-entry.hotspotX * 100}%,${-entry.hotspotY * 100}%)`;
      }
    }
    renderPreviewCanvas(
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
      },
      { t, p, m, data, view, cam, clip, cursorEvents },
    );
  }, []);
  useEffect(() => {
    if (!assetRoot) return;
    const entries = new Map(
      [
        null,
        { kind: "pointinghand" },
        { kind: "ibeam" },
        { kind: "hand" },
        { kind: "text" },
      ].map((point) => {
        const entry = cursorImage(look, point as CursorEvent | null);
        return [entry.file, entry] as const;
      }),
    );
    for (const entry of entries.values()) {
      const image = new Image();
      image.onload = () => draw(video.current?.currentTime ?? 0);
      image.src = convertFileSrc(assetPath(assetRoot, entry.file));
      cursorImages.current.set(entry.file, image);
    }
    return () => {
      for (const entry of entries.values()) {
        const image = cursorImages.current.get(entry.file);
        if (image) image.onload = null;
      }
    };
  }, [assetRoot, look.cursorTheme, look.cursorAsset, draw]);
  useEffect(() => {
    draw(video.current?.currentTime || time);
  }, [project, size, time, draw, selected, panel, previewQuality]);
  useEffect(() => {
    const element = video.current;
    if (!element || !playing) return;
    let frame = 0,
      lastUpdate = 0,
      active = true;
    if (plane.current) plane.current.style.willChange = "transform";
    const tick = () => {
      if (!active) return;
      const p = projectRef.current;
      if (p) {
        const kept = renderData.current.ranges,
          first = kept[0],
          last = kept[kept.length - 1];
        if (!first || !last || element.currentTime >= last.end) {
          element.pause();
          if (last) {
            element.currentTime = last.end;
            setTime(last.end);
          }
          setPlaying(false);
          return;
        }
        const next = kept.find((clip) => element.currentTime < clip.end);
        if (next && element.currentTime < next.start) {
          element.currentTime = next.start;
          setTime(next.start);
        }
      }
      const current = renderData.current.ranges.find(
        (clip) =>
          element.currentTime >= clip.start && element.currentTime < clip.end,
      );
      element.playbackRate = rate * (current ? clipSpeed(current) : 1);
      const facecam = webcamVideo.current;
      if (facecam && p?.webcam) {
        facecam.playbackRate = element.playbackRate;
        if (
          Math.abs(facecam.currentTime - element.currentTime) >
          Math.max(1 / 30, element.playbackRate / 30)
        )
          facecam.currentTime = element.currentTime;
      }
      const voice = microphoneAudio.current;
      if (voice && p?.microphone) {
        voice.playbackRate = element.playbackRate;
        if (
          Math.abs(voice.currentTime - element.currentTime) >
          Math.max(1 / 30, element.playbackRate / 30)
        )
          voice.currentTime = element.currentTime;
      }
      const soundtrack = audio.current;
      if (soundtrack?.duration && Number.isFinite(soundtrack.duration)) {
        const audioTime =
          sourceToEdited(element.currentTime, renderData.current.ranges) %
          soundtrack.duration;
        if (Math.abs(soundtrack.currentTime - audioTime) > 0.2)
          soundtrack.currentTime = audioTime;
      }
      draw(element.currentTime);
      if (performance.now() - lastUpdate > 250) {
        setTime(element.currentTime);
        lastUpdate = performance.now();
      }
      // Camera/cursor still animate over a held video frame from an idle screen.
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      if (plane.current) plane.current.style.willChange = "";
    };
  }, [playing, draw, rate]);
  return { draw };
}
