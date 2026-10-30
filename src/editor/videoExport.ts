import type { RefObject } from "react";
import { annotationImage, canvasEffect, graphicEffect } from "../annotations";
import { cameraMotionBlur, type cameraMotionFor } from "../cinematic";
import { clipRanges } from "../timeline";
import type { CameraKey, CursorEvent } from "../zoom";
import { webcamForAspect } from "./project-utils";
import type { Media, Operation, Project } from "./types";

type NativeAction = <T>(
  name: string,
  args?: Record<string, unknown>,
) => Promise<T | undefined>;

type VideoExportOptions = {
  action: NativeAction;
  project: Project | null;
  media: Media | null;
  video: RefObject<HTMLVideoElement | null>;
  sceneAspect: number;
  sourceAspect: number;
  cameraMotion: ReturnType<typeof cameraMotionFor>;
  impactTimes: number[];
  cropFill: boolean;
  trajectory: CameraKey[];
  events: CursorEvent[];
  activity: ReturnType<typeof import("../cursor-activity").cursorActivity>;
  codec: string;
  quality: string;
  resolution: number;
  fps: number;
  setOperation: (operation: Operation) => void;
  setProgress: (progress: number) => void;
};

export function createVideoExport(options: VideoExportOptions) {
  const {
    action,
    project,
    media,
    video,
    sceneAspect,
    sourceAspect,
    cameraMotion,
    impactTimes,
    cropFill,
    trajectory,
    events,
    activity,
    codec,
    quality,
    resolution,
    fps,
    setOperation,
    setProgress,
  } = options;

  async function exportVideo() {
    if (!project || !media) return;
    video.current?.pause();
    setOperation("exporting");
    setProgress(0);
    const started = await action<boolean>("export_video", {
      settings: {
        start: project.trim.start,
        end: project.trim.end,
        ranges: clipRanges(project.trim, project.clips).map(
          ({ index: _index, ...clip }) => clip,
        ),
        effects: project.effects ?? [],
        annotationImages: Object.fromEntries(
          (project.effects ?? [])
            .filter((effect) => graphicEffect(effect.kind))
            .map((effect) => [
              effect.id,
              annotationImage(
                effect,
                canvasEffect(effect.kind) ? sceneAspect : sourceAspect,
              ).split(",")[1],
            ]),
        ),
        backgroundAudio: project.backgroundAudio,
        microphone: project.microphone,
        sourceVolume: project.sourceVolume ?? 1,
        webcam: project.webcam
          ? {
              ...webcamForAspect(project.webcam, project.appearance.aspect),
              layouts: undefined,
            }
          : undefined,
        appearance: {
          ...project.appearance,
          cameraMotion: { ...cameraMotion, impacts: impactTimes },
          cropFill,
          motionBlur: cameraMotionBlur(project.appearance),
        },
        keys: trajectory,
        cursor: events,
        rawCursor: media.cursor,
        cursorActivity: activity,
        codec,
        quality,
        resolution,
        fps,
      },
    });
    if (!started) setOperation("idle");
  }

  return exportVideo;
}
