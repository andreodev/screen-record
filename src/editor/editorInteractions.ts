import type {
  Dispatch,
  MutableRefObject,
  RefObject,
  SetStateAction,
} from "react";
import { canvasEffect } from "../annotations";
import type { CropRect } from "../crop";
import type { Effect } from "../timeline";
import {
  cameraFromKeys,
  clamp,
  cursorAt,
  type Appearance,
  type CameraKey,
  type Zoom,
} from "../zoom";
import {
  planWebcamState,
  webcamAt,
  webcamFrame,
  type Webcam,
  type WebcamKeyframe,
} from "../webcam";
import { webcamForAspect, webcamLayout } from "./project-utils";
import type { Media, Panel, Project } from "./types";

type Histories = MutableRefObject<{ past: Project[]; future: Project[] }>;
type InteractionOptions = {
  projectRef: MutableRefObject<Project | null>;
  busy: boolean;
  video: RefObject<HTMLVideoElement | null>;
  look: Appearance;
  time: number;
  previewZoomScale: number;
  webcamSourceAspect: number;
  histories: Histories;
  setPast: Dispatch<SetStateAction<Project[]>>;
  setFuture: Dispatch<SetStateAction<Project[]>>;
  setProject: Dispatch<SetStateAction<Project | null>>;
  project: Project | null;
  media: Media | null;
  trajectory: CameraKey[];
  sourceCrop: CropRect;
  edit: (update: (project: Project) => Project) => void;
  setSelected: Dispatch<SetStateAction<string | null>>;
  setSelectedClip: Dispatch<SetStateAction<number | null>>;
  setSelectedEffect: Dispatch<SetStateAction<string | null>>;
  setPanel: Dispatch<SetStateAction<Panel>>;
  seek: (time: number) => void;
  currentZoom: Zoom | null | undefined;
  visibleSpanX: number;
  visibleSpanY: number;
};

export function createEditorInteractions(options: InteractionOptions) {
  const {
    projectRef,
    busy,
    video,
    look,
    time,
    previewZoomScale,
    webcamSourceAspect,
    histories,
    setPast,
    setFuture,
    setProject,
    project,
    media,
    trajectory,
    sourceCrop,
    edit,
    setSelected,
    setSelectedClip,
    setSelectedEffect,
    setPanel,
    seek,
    currentZoom,
    visibleSpanX,
    visibleSpanY,
  } = options;
  function dragWebcam(event: React.PointerEvent<HTMLElement>, resize = false) {
    const original = projectRef.current;
    if (event.button !== 0 || busy || !original?.webcam) return;
    event.preventDefault();
    event.stopPropagation();
    video.current?.pause();
    const rect = event.currentTarget.closest(".scene")!.getBoundingClientRect(),
      startX = event.clientX,
      startY = event.clientY,
      aspectKey =
        look.aspect === "9:16"
          ? "portrait"
          : look.aspect === "16:9"
            ? "landscape"
            : null,
      initialCamera = webcamForAspect(original.webcam, look.aspect),
      initial = planWebcamState(
        webcamAt(initialCamera, time),
        previewZoomScale,
        look.aspect,
      ),
      initialFrame = webcamFrame(
        initial,
        rect.width,
        rect.height,
        webcamSourceAspect,
      );
    let saved = false;
    const move = (e: PointerEvent) => {
      const p = projectRef.current;
      if (!p?.webcam) return;
      if (!saved) {
        histories.current = {
          past: [...histories.current.past.slice(-49), original],
          future: [],
        };
        setPast(histories.current.past);
        setFuture([]);
        saved = true;
      }
      const base = p.webcam,
        camera = webcamForAspect(base, look.aspect),
        current = webcamAt(camera, time);
      const dx = e.clientX - startX,
        dy = e.clientY - startY;
      const nextSize = resize
        ? clamp(
            initial.size *
              (1 +
                (2 * (dx * initialFrame.width + dy * initialFrame.height)) /
                  (initialFrame.width ** 2 + initialFrame.height ** 2)),
            0.08,
            0.6,
          )
        : initial.size;
      const frame = webcamFrame(
        {
          ...initial,
          size: nextSize,
          x: resize ? initialFrame.x : initialFrame.x + dx / rect.width,
          y: resize ? initialFrame.y : initialFrame.y + dy / rect.height,
        },
        rect.width,
        rect.height,
        webcamSourceAspect,
      );
      const position = { x: frame.x, y: frame.y, size: nextSize };
      const keys = camera.keyframes ?? [];
      const key: WebcamKeyframe = {
        t: time,
        ...current,
        ...position,
        easing: "ease-in-out",
      };
      const updated: Webcam =
        keys.length && camera.mode !== "static"
          ? {
              ...camera,
              mode: "manual",
              keyframes: [
                ...keys.filter((item) => Math.abs(item.t - time) >= 0.02),
                key,
              ].sort((a, b) => a.t - b.t),
            }
          : { ...camera, mode: "static", zoomBehavior: "keep", ...position };
      const webcam: Webcam = aspectKey
        ? {
            ...base,
            layouts: { ...base.layouts, [aspectKey]: webcamLayout(updated) },
          }
        : { ...updated, layouts: base.layouts };
      const next = { ...p, version: 11 as const, webcam };
      projectRef.current = next;
      setProject(next);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }
  function addEffect(kind: Effect["kind"]) {
    if (!project || !media || busy) return;
    const start = clamp(
      video.current?.currentTime ?? time,
      0,
      Math.max(0, media.duration - 0.1),
    );
    video.current?.pause();
    const focus =
      (kind === "spotlight" ? cursorAt(start, media.cursor) : null) ??
      cameraFromKeys(start, trajectory);
    const effectWidth = Math.max(0.02, 0.28 * sourceCrop.width);
    const effectHeight = Math.max(0.02, 0.22 * sourceCrop.height);
    const effect: Effect = {
      id: crypto.randomUUID(),
      kind,
      start: kind === "watermark" ? 0 : start,
      end:
        kind === "watermark"
          ? media.duration
          : Math.min(media.duration, start + 2),
      x:
        kind === "watermark"
          ? 0.83
          : canvasEffect(kind)
            ? 0.5
            : clamp(
                focus.x,
                sourceCrop.x + effectWidth / 2,
                sourceCrop.x + sourceCrop.width - effectWidth / 2,
              ),
      y:
        kind === "caption"
          ? 0.87
          : kind === "watermark"
            ? 0.08
            : clamp(
                focus.y,
                sourceCrop.y + effectHeight / 2,
                sourceCrop.y + sourceCrop.height - effectHeight / 2,
              ),
      width: kind === "caption" ? 0.8 : canvasEffect(kind) ? 0.28 : effectWidth,
      height: canvasEffect(kind) ? 0.12 : effectHeight,
      opacity: kind === "highlight" ? 0.28 : kind === "spotlight" ? 0.65 : 1,
      ...(["text", "caption", "watermark"].includes(kind)
        ? { text: kind === "watermark" ? "Sua marca" : "Seu texto" }
        : {}),
    };
    edit((p) => ({
      ...p,
      version: 12,
      effects: [...(p.effects ?? []), effect],
    }));
    setSelected(null);
    setSelectedClip(null);
    setSelectedEffect(effect.id);
    setPanel("effect");
    seek(start);
  }
  function dragEffect(
    event: React.PointerEvent<HTMLElement>,
    effect: Effect,
    kind: "move" | "resize" = "move",
  ) {
    if (event.button !== 0 || busy) return;
    event.preventDefault();
    event.stopPropagation();
    video.current?.pause();
    const viewport = (event.currentTarget.closest(".source-overlays") ??
        event.currentTarget.closest(".scene"))!.getBoundingClientRect(),
      startX = event.clientX,
      startY = event.clientY,
      original = projectRef.current;
    if (!original) return;
    let saved = false;
    const move = (e: PointerEvent) => {
      const p = projectRef.current;
      if (!p) return;
      if (!saved) {
        histories.current = {
          past: [...histories.current.past.slice(-49), original],
          future: [],
        };
        setPast(histories.current.past);
        setFuture([]);
        saved = true;
      }
      const current = original.effects?.find((item) => item.id === effect.id);
      if (!current) return;
      const dx = (e.clientX - startX) / viewport.width,
        dy = (e.clientY - startY) / viewport.height;
      const nextEffect =
        kind === "move"
          ? {
              ...current,
              x: clamp(
                current.x + dx,
                current.width / 2,
                1 - current.width / 2,
              ),
              y: clamp(
                current.y + dy,
                current.height / 2,
                1 - current.height / 2,
              ),
            }
          : {
              ...current,
              width: clamp(
                current.width + dx,
                0.04,
                2 * Math.min(current.x, 1 - current.x),
              ),
              height: clamp(
                current.height + dy,
                0.04,
                2 * Math.min(current.y, 1 - current.y),
              ),
            };
      const next = {
        ...p,
        version: 12 as const,
        effects: p.effects?.map((item) =>
          item.id === effect.id ? nextEffect : item,
        ),
      };
      projectRef.current = next;
      setProject(next);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }
  function dragFocus(event: React.PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || busy || !currentZoom || !project) return;
    event.preventDefault();
    event.stopPropagation();
    video.current?.pause();
    const viewport = event.currentTarget.parentElement!.getBoundingClientRect();
    const original = project,
      zoomId = currentZoom.id;
    let saved = false;
    const move = (e: PointerEvent) => {
      if (!saved) {
        histories.current = {
          past: [...histories.current.past.slice(-49), original],
          future: [],
        };
        setPast(histories.current.past);
        setFuture([]);
        saved = true;
      }
      const halfX = (visibleSpanX * sourceCrop.width) / (2 * currentZoom.scale),
        halfY = (visibleSpanY * sourceCrop.height) / (2 * currentZoom.scale);
      const x = clamp(
        (e.clientX - viewport.left) / viewport.width,
        sourceCrop.x + halfX,
        sourceCrop.x + sourceCrop.width - halfX,
      );
      const y = clamp(
        (e.clientY - viewport.top) / viewport.height,
        sourceCrop.y + halfY,
        sourceCrop.y + sourceCrop.height - halfY,
      );
      const p = projectRef.current;
      if (!p) return;
      const next: Project = {
        ...p,
        version: 4,
        zooms: p.zooms.map((z) =>
          z.id === zoomId
            ? { ...z, x, y, follow: false, manualOverride: true }
            : z,
        ),
      };
      projectRef.current = next;
      setProject(next);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  }
  function addZoom(t = time) {
    if (!project || !media || busy) return;
    const start = clamp(t, 0, Math.max(0, media.duration - 0.2)),
      end = Math.min(media.duration, start + 2.4),
      point = cursorAt(t, media.cursor);
    const scale = 1.65,
      halfX = (visibleSpanX * sourceCrop.width) / (2 * scale),
      halfY = (visibleSpanY * sourceCrop.height) / (2 * scale);
    const z: Zoom = {
      id: crypto.randomUUID(),
      start,
      end,
      scale,
      x: clamp(
        point?.x ?? sourceCrop.x + sourceCrop.width / 2,
        sourceCrop.x + halfX,
        sourceCrop.x + sourceCrop.width - halfX,
      ),
      y: clamp(
        point?.y ?? sourceCrop.y + sourceCrop.height / 2,
        sourceCrop.y + halfY,
        sourceCrop.y + sourceCrop.height - halfY,
      ),
      enabled: true,
    };
    edit((p) => ({ ...p, zooms: [...p.zooms, z] }));
    setSelected(z.id);
    setSelectedClip(null);
    setSelectedEffect(null);
    setPanel("zoom");
    seek(Math.min(end, start + 0.7));
  }
  function dragTimelineItem(event: React.PointerEvent<HTMLButtonElement>, item: Zoom | Effect, kind: "zoom" | "effect") {
    const original = projectRef.current;
    if (event.button !== 0 || busy || !media || !original) return;
    event.preventDefault();
    event.stopPropagation();
    video.current?.pause();
    const button = event.currentTarget;
    const rect = event.currentTarget.getBoundingClientRect(),
      track = event.currentTarget.parentElement!.getBoundingClientRect();
    if (track.width <= 0) return;
    const edge = (event.target as HTMLElement).closest<HTMLElement>("[data-timing-edge]")?.dataset.timingEdge;
    const mode =
      edge === "start" || edge === "end" ? edge : kind === "zoom" && event.clientX - rect.left < 8
        ? "start"
        : kind === "zoom" && rect.right - event.clientX < 8
          ? "end"
          : "move";
    const startX = event.clientX, pointerId = event.pointerId;
    let moved = false;
    button.setPointerCapture(pointerId);
    const select = () => {
      setSelected(kind === "zoom" ? item.id : null);
      setSelectedEffect(kind === "effect" ? item.id : null);
      setSelectedClip(null);
      setPanel(kind);
    };
    select();
    const move = (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      if (Math.abs(e.clientX - startX) < 2 && !moved) return;
      const delta = ((e.clientX - startX) / track.width) * media.duration;
      const patch =
        mode === "start"
          ? { start: clamp(item.start + delta, 0, item.end - 0.1), end: item.end }
          : mode === "end"
            ? { start: item.start, end: clamp(item.end + delta, item.start + 0.1, media.duration) }
            : (() => {
                const start = clamp(
                  item.start + delta,
                  0,
                  media.duration - (item.end - item.start),
                );
                return { start, end: start + item.end - item.start };
              })();
      const current = projectRef.current;
      const timed = kind === "zoom" ? current?.zooms : current?.effects;
      const previous = timed?.find(value => value.id === item.id);
      if (!current || !previous || (previous.start === patch.start && previous.end === patch.end)) return;
      if (!moved) {
        histories.current = {
          past: [...histories.current.past.slice(-49), original],
          future: [],
        };
        setPast(histories.current.past);
        setFuture([]);
        moved = true;
      }
      const next: Project = kind === "zoom" ? {
        ...current,
        zooms: current.zooms.map(zoom => zoom.id === item.id ? { ...zoom, ...patch, manualOverride: true } : zoom),
      } : {
        ...current,
        effects: current.effects?.map(effect => effect.id === item.id ? { ...effect, ...patch } : effect),
      };
      projectRef.current = next;
      setProject(next);
    };
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", end);
      if (button.hasPointerCapture(pointerId)) button.releasePointerCapture(pointerId);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", end);
  }
  const dragZoom = (event: React.PointerEvent<HTMLButtonElement>, zoom: Zoom) => dragTimelineItem(event, zoom, "zoom");
  const dragEffectTiming = (event: React.PointerEvent<HTMLButtonElement>, effect: Effect) => dragTimelineItem(event, effect, "effect");
  return { dragWebcam, addEffect, dragEffect, dragFocus, addZoom, dragZoom, dragEffectTiming };
}
