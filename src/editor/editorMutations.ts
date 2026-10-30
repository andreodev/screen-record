import type {
  Dispatch,
  MutableRefObject,
  RefObject,
  SetStateAction,
} from "react";
import type { CropRect } from "../crop";
import {
  clipRanges,
  editedDuration,
  type Clip,
  type Effect,
} from "../timeline";
import { clamp, type Appearance, type Zoom } from "../zoom";
import {
  planWebcamState,
  webcamAt,
  type Webcam,
  type WebcamKeyframe,
} from "../webcam";
import { webcamForAspect, webcamLayout } from "./project-utils";
import type { Media, Project } from "./types";

type EditorMutationOptions = {
  edit: (update: (project: Project) => Project) => void;
  setSelected: Dispatch<SetStateAction<string | null>>;
  projectRef: MutableRefObject<Project | null>;
  setNotice: Dispatch<SetStateAction<string>>;
  seek: (time: number) => void;
  video: RefObject<HTMLVideoElement | null>;
  selected: string | null;
  visibleSpanX: number;
  visibleSpanY: number;
  sourceCrop: CropRect;
  selectedClip: number | null;
  media: Media | null;
  selectedEffect: string | null;
  look: Appearance;
  time: number;
  previewZoomScale: number;
  project: Project | null;
};

export function createEditorMutations(options: EditorMutationOptions) {
  const {
    edit,
    setSelected,
    projectRef,
    setNotice,
    seek,
    video,
    selected,
    visibleSpanX,
    visibleSpanY,
    sourceCrop,
    selectedClip,
    media,
    selectedEffect,
    look,
    time,
    previewZoomScale,
    project,
  } = options;
  function appearance(patch: Partial<Appearance>) {
    edit((p) => ({
      ...p,
      version: p.appearance.crop || patch.crop ? 14 : 13,
      appearance: {
        ...p.appearance,
        ...(patch.smooth !== undefined
          ? { cursorSmooth: p.appearance.cursorSmooth ?? p.appearance.smooth }
          : {}),
        ...patch,
      },
    }));
  }
  function setClickSoundVolume(volume: number) {
    appearance({ clickSoundVolume: volume });
  }
  function setCameraMode(mode: NonNullable<Appearance["cameraMode"]>) {
    appearance({ cameraMode: mode });
    setSelected(null);
  }
  function changeTrim(trim: Clip) {
    const p = projectRef.current;
    if (!p) return;
    if (editedDuration(clipRanges(trim, p.clips)) < 0.1) {
      setNotice(
        "Escolha um intervalo que contenha pelo menos 0,1 segundo de vídeo mantido.",
      );
      return;
    }
    edit((p) => ({ ...p, trim }));
    seek(video.current?.currentTime ?? trim.start);
  }
  function zoomChange(patch: Partial<Zoom>) {
    edit((p) => ({
      ...p,
      version: 4,
      zooms: p.zooms.map((z) => {
        if (z.id !== selected) return z;
        const scale = patch.scale ?? z.scale,
          halfX = (visibleSpanX * sourceCrop.width) / (2 * scale),
          halfY = (visibleSpanY * sourceCrop.height) / (2 * scale);
        return {
          ...z,
          ...patch,
          manualOverride: true,
          ...(patch.x === undefined
            ? {}
            : {
                x: clamp(
                  patch.x,
                  sourceCrop.x + halfX,
                  sourceCrop.x + sourceCrop.width - halfX,
                ),
              }),
          ...(patch.y === undefined
            ? {}
            : {
                y: clamp(
                  patch.y,
                  sourceCrop.y + halfY,
                  sourceCrop.y + sourceCrop.height - halfY,
                ),
              }),
        };
      }),
    }));
  }
  function clipChange(patch: Partial<Clip>) {
    if (selectedClip === null || !media) return;
    const clips = (
      projectRef.current?.clips ?? [{ start: 0, end: media.duration }]
    ).map((clip, index) =>
      index === selectedClip ? { ...clip, ...patch } : clip,
    );
    if (
      projectRef.current &&
      editedDuration(clipRanges(projectRef.current.trim, clips)) < 0.1
    ) {
      setNotice("Mantenha pelo menos 0,1 segundo de vídeo editado.");
      return;
    }
    video.current?.pause();
    edit((p) => ({ ...p, version: 4, clips }));
  }
  function effectChange(patch: Partial<Effect>) {
    if (!selectedEffect) return;
    edit((p) => ({
      ...p,
      version: 12,
      effects: (p.effects ?? []).map((effect) =>
        effect.id === selectedEffect ? { ...effect, ...patch } : effect,
      ),
    }));
  }
  function webcamChange(patch: Partial<Webcam> & Partial<WebcamKeyframe>) {
    edit((p) => {
      if (!p.webcam) return p;
      const original = p.webcam,
        aspectKey =
          look.aspect === "9:16"
            ? "portrait"
            : look.aspect === "16:9"
              ? "landscape"
              : null;
      const camera = webcamForAspect(original, look.aspect),
        keys = camera.keyframes ?? [];
      const save = (value: Webcam): Project => ({
        ...p,
        version: 11,
        webcam: aspectKey
          ? {
              ...original,
              layouts: {
                ...original.layouts,
                [aspectKey]: webcamLayout(value),
              },
            }
          : { ...value, layouts: original.layouts },
      });
      const animated = [
        "x",
        "y",
        "size",
        "opacity",
        "borderRadius",
        "easing",
      ].some((name) => name in patch);
      if (!animated || !keys.length || (camera.mode ?? "static") === "static")
        return save({ ...camera, ...patch });
      const at = clamp(time, p.trim.start, p.trim.end),
        value = webcamAt(camera, at);
      const key: WebcamKeyframe = {
        t: at,
        x: patch.x ?? value.x,
        y: patch.y ?? value.y,
        size: patch.size ?? value.size,
        opacity: patch.opacity ?? value.opacity,
        borderRadius: patch.borderRadius ?? value.borderRadius,
        easing:
          patch.easing ??
          keys.find((item) => Math.abs(item.t - at) < 0.02)?.easing ??
          "ease-in-out",
      };
      const index = keys.findIndex((item) => Math.abs(item.t - at) < 0.02);
      const nextKeys =
        index >= 0
          ? keys.map((item, i) => (i === index ? key : item))
          : [...keys, key].sort((a, b) => a.t - b.t);
      const {
        x: _x,
        y: _y,
        size: _size,
        opacity: _opacity,
        borderRadius: _radius,
        easing: _easing,
        ...basePatch
      } = patch;
      return save({
        ...camera,
        ...basePatch,
        mode: "manual",
        keyframes: nextKeys,
      });
    });
  }
  function toggleWebcamKeyframe() {
    edit((p) => {
      if (!p.webcam || !media) return p;
      const original = p.webcam,
        aspectKey =
          look.aspect === "9:16"
            ? "portrait"
            : look.aspect === "16:9"
              ? "landscape"
              : null;
      const camera = webcamForAspect(original, look.aspect),
        at = clamp(time, p.trim.start, p.trim.end),
        keys = [...(camera.keyframes ?? [])];
      const save = (value: Webcam): Project => ({
        ...p,
        version: 11,
        webcam: aspectKey
          ? {
              ...original,
              layouts: {
                ...original.layouts,
                [aspectKey]: webcamLayout(value),
              },
            }
          : { ...value, layouts: original.layouts },
      });
      const index = keys.findIndex((item) => Math.abs(item.t - at) < 0.02);
      if (index >= 0) {
        keys.splice(index, 1);
        return save({
          ...camera,
          keyframes: keys,
          mode: keys.length ? "manual" : "static",
        });
      }
      const state = planWebcamState(
        webcamAt(camera, at),
        previewZoomScale,
        look.aspect,
      );
      if (!keys.length)
        keys.push({
          t: p.trim.start,
          x: camera.x,
          y: camera.y,
          size: camera.size,
          opacity: camera.opacity ?? 1,
          borderRadius:
            camera.borderRadius ??
            (camera.shape === "circle"
              ? 0.5
              : camera.shape === "square"
                ? 0
                : 0.18),
          easing: "ease-in-out",
        });
      if (Math.abs(at - p.trim.start) >= 0.02)
        keys.push({
          t: at,
          x: state.x,
          y: state.y,
          size: state.size,
          opacity: state.opacity,
          borderRadius: state.borderRadius,
          easing: "ease-in-out",
        });
      keys.sort((a, b) => a.t - b.t);
      return save({ ...camera, mode: "manual", keyframes: keys });
    });
  }
  function retimeWebcamKeyframe(nextTime: number, keyTime = time) {
    if (!project?.webcam) return;
    const at = clamp(nextTime, project.trim.start, project.trim.end),
      original = project.webcam;
    const aspectKey =
      look.aspect === "9:16"
        ? "portrait"
        : look.aspect === "16:9"
          ? "landscape"
          : null;
    const camera = webcamForAspect(original, look.aspect),
      keys = camera.keyframes ?? [];
    const index = keys.findIndex((key) => Math.abs(key.t - keyTime) < 0.02);
    if (
      index < 0 ||
      keys.some((key, i) => i !== index && Math.abs(key.t - at) < 0.02)
    )
      return;
    const updated = {
      ...camera,
      keyframes: keys
        .map((key, i) => (i === index ? { ...key, t: at } : key))
        .sort((a, b) => a.t - b.t),
    };
    edit((p) => ({
      ...p,
      version: 11,
      webcam: aspectKey
        ? {
            ...original,
            layouts: {
              ...original.layouts,
              [aspectKey]: webcamLayout(updated),
            },
          }
        : { ...updated, layouts: original.layouts },
    }));
  }
  return {
    appearance,
    setClickSoundVolume,
    setCameraMode,
    changeTrim,
    zoomChange,
    clipChange,
    effectChange,
    webcamChange,
    toggleWebcamKeyframe,
    retimeWebcamKeyframe,
  };
}
