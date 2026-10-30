import { useMemo } from "react";
import { cursorActivity } from "../cursor-activity";
import { cropPoint, sourcePoint, normalizedCrop } from "../crop";
import {
  cameraMotionFor,
  motionImpacts,
  webcamMotionState,
  cinematicKeys,
  cursorResponseFor,
  responsiveCursor,
} from "../cinematic";
import {
  cameraFromKeys,
  cameraKeys,
  clamp,
  cursorAt,
  cursorMotionFor,
  defaults,
  frameLayout,
  smoothCursor,
  visibleSpans,
  zoomsForMode,
} from "../zoom";
import {
  webcamFocusScale,
  webcamAt,
  planWebcamState,
  webcamFrame,
} from "../webcam";
import { cursorImage } from "../cursor";
import { clipRanges, editedDuration, sourceToEdited } from "../timeline";
import type { Media, Project } from "./types";
import { webcamForAspect } from "./project-utils";

type PreviewModelOptions = {
  project: Project | null;
  media: Media | null;
  selected: string | null;
  selectedClip: number | null;
  selectedEffect: string | null;
  time: number;
  areaSize: { width: number; height: number };
  webcamSourceAspect: number;
};

export function usePreviewModel({
  project,
  media,
  selected,
  selectedClip,
  selectedEffect,
  time,
  areaSize,
  webcamSourceAspect,
}: PreviewModelOptions) {
  const look = project?.appearance || defaults;
  const ranges = useMemo(
    () => (project ? clipRanges(project.trim, project.clips) : []),
    [project?.trim, project?.clips],
  );
  const duration = editedDuration(ranges);
  const editedTime = sourceToEdited(time, ranges);
  const currentZoom = project?.zooms.find((z) => z.id === selected);
  const cameraMode = look.cameraMode ?? "hybrid";
  const visibleEffects =
    project?.effects?.filter(
      (effect) =>
        effect.id === selectedEffect ||
        (effect.start <= time + 1 && effect.end >= time - 1),
    ) ?? [];
  const currentEffect = project?.effects?.find(
    (effect) => effect.id === selectedEffect,
  );
  const selectedWebcam = project?.webcam
    ? webcamForAspect(project.webcam, look.aspect)
    : undefined;
  const webcamKeyed = !!selectedWebcam?.keyframes?.some(
    (key) => Math.abs(key.t - time) < 0.02,
  );
  const canEditCursor = !!media?.cursorCaptured && media.cursor.length > 0;
  const cursorMotion = cursorMotionFor(look);
  const smoothedEvents = useMemo(
    () =>
      cursorMotion === "original"
        ? media?.cursor || []
        : smoothCursor(
            media?.cursor || [],
            cursorMotion === "smooth"
              ? 0.1
              : cursorMotion === "rapid"
                ? 0.035
                : 0.065,
          ),
    [media, cursorMotion],
  );
  const activity = useMemo(
    () => cursorActivity(media?.cursor ?? []),
    [media?.cursor],
  );
  const clickTimes = useMemo(() => {
    const clicks: number[] = [];
    let wasDown = false;
    for (const point of media?.cursor ?? []) {
      const isDown = point.down || !!point.rightDown || !!point.middleDown;
      if (isDown && !wasDown) clicks.push(point.t);
      wasDown = isDown;
    }
    return clicks;
  }, [media?.cursor]);
  const cursorSmooth = cursorMotion !== "original";
  const sourceCrop = useMemo(() => normalizedCrop(look.crop), [look.crop]);
  const sourceAspect = media ? media.width / media.height : 16 / 10;
  const croppedAspect = (sourceAspect * sourceCrop.width) / sourceCrop.height;
  const cameraZooms = useMemo(
    () => zoomsForMode(project?.zooms ?? [], cameraMode),
    [project?.zooms, cameraMode],
  );
  const sceneAspect =
    look.aspect === "auto"
      ? croppedAspect
      : look.aspect === "16:9"
        ? 16 / 9
        : look.aspect === "9:16"
          ? 9 / 16
          : 1;
  const size = {
    width: Math.min(areaSize.width, areaSize.height * sceneAspect),
    height: Math.min(areaSize.height, areaSize.width / sceneAspect),
  };
  const cropFill = !!look.cropFill;
  const followCropCursor = !!look.cropFollowCursor;
  const cameraPadding =
    (Math.min(size.width, size.height) * look.padding) / 100;
  const contentAspect =
    (size.width - 2 * cameraPadding) / (size.height - 2 * cameraPadding);
  const visibleVideo = visibleSpans(croppedAspect, contentAspect, cropFill);
  const visibleSpanX = visibleVideo.x,
    visibleSpanY = visibleVideo.y;
  const cameraMotion = useMemo(
    () => cameraMotionFor(look),
    [look.cameraMotion, look.cameraSpring],
  );
  const cursorResponse = useMemo(
    () => cursorResponseFor(look),
    [look.cursorResponse],
  );
  const baseTrajectory = useMemo(
    () =>
      media && project
        ? cameraKeys(
            cameraZooms.map((zoom) => {
              const point = cropPoint(zoom, sourceCrop);
              return {
                ...point,
                x: clamp(point.x, 0, 1),
                y: clamp(point.y, 0, 1),
                roiWidth: (zoom.roiWidth ?? 0.3) / sourceCrop.width,
                roiHeight: (zoom.roiHeight ?? 0.64) / sourceCrop.height,
              };
            }),
            media.duration,
            look.smooth,
            smoothedEvents.map((point) => cropPoint(point, sourceCrop)),
            cameraMotion.spring,
            visibleSpanX,
            visibleSpanY,
            followCropCursor && cameraMode !== "manual",
            false,
            croppedAspect,
            contentAspect,
            cameraMotion.damping,
            {
              cursorFollow: look.cursorFollow,
              zoomAnticipation: look.zoomAnticipation,
            },
          )
        : [],
    [
      cameraZooms,
      media,
      look.smooth,
      cameraMotion.spring,
      cameraMotion.damping,
      followCropCursor,
      cameraMode,
      look.aspect,
      smoothedEvents,
      look.cursorFollow,
      look.zoomAnticipation,
      visibleSpanX,
      visibleSpanY,
      sourceCrop,
      croppedAspect,
    ],
  );
  const trajectory = useMemo(() => {
    const layout = frameLayout(croppedAspect, contentAspect, cropFill);
    const width =
      (layout.width * (size.width - 2 * cameraPadding)) / size.width;
    const height =
      (layout.height * (size.height - 2 * cameraPadding)) / size.height;
    return cinematicKeys(baseTrajectory, cameraMotion, width, height).map(
      (key) => sourcePoint(key, sourceCrop),
    );
  }, [
    baseTrajectory,
    cameraMotion,
    croppedAspect,
    sourceCrop,
    contentAspect,
    cropFill,
    size.width,
    size.height,
    cameraPadding,
    visibleSpanX,
    visibleSpanY,
  ]);
  const events = useMemo(() => {
    const layout = frameLayout(croppedAspect, contentAspect, cropFill);
    const width =
      (layout.width * (size.width - 2 * cameraPadding)) /
      size.width /
      sourceCrop.width;
    const height =
      (layout.height * (size.height - 2 * cameraPadding)) /
      size.height /
      sourceCrop.height;
    return responsiveCursor(
      smoothedEvents,
      trajectory,
      cursorResponse,
      width,
      height,
    );
  }, [
    smoothedEvents,
    trajectory,
    cursorResponse,
    croppedAspect,
    sourceCrop,
    contentAspect,
    cropFill,
    size.width,
    size.height,
    cameraPadding,
  ]);
  const impactTimes = useMemo(
    () => motionImpacts(baseTrajectory, cameraMotion.impacts),
    [baseTrajectory, cameraMotion.impacts],
  );
  const cameraCuts = useMemo(
    () => trajectory.filter((k) => k.cut).map((k) => k.t),
    [trajectory],
  );
  const previewZoomScale = webcamFocusScale(
    time,
    (at) => cameraFromKeys(at, trajectory).scale,
    selectedWebcam?.transitionDuration,
  );
  const currentWebcam = selectedWebcam
    ? webcamMotionState(
        planWebcamState(
          webcamAt(selectedWebcam, time),
          previewZoomScale,
          look.aspect,
        ),
        time,
        cameraMotion,
        impactTimes,
      )
    : undefined;
  const overlayFrame = currentWebcam
    ? webcamFrame(currentWebcam, size.width, size.height, webcamSourceAspect)
    : null;
  const currentClip =
    selectedClip === null
      ? null
      : (project?.clips ?? (media ? [{ start: 0, end: media.duration }] : []))[
          selectedClip
        ];
  const selectedCursor = cursorImage(look, cursorAt(time, events));
  const padding = (Math.min(size.width, size.height) * look.padding) / 100;
  const contentWidth = size.width - padding * 2;
  const contentHeight = size.height - padding * 2;
  const layout = frameLayout(
    croppedAspect,
    contentWidth / contentHeight,
    cropFill,
  );
  const vw = contentWidth * layout.width;
  const vh = contentHeight * layout.height;
  return {
    look,
    ranges,
    duration,
    editedTime,
    currentZoom,
    cameraMode,
    visibleEffects,
    currentEffect,
    selectedWebcam,
    webcamKeyed,
    canEditCursor,
    cursorSmooth,
    sourceCrop,
    sourceAspect,
    croppedAspect,
    sceneAspect,
    size,
    cropFill,
    followCropCursor,
    visibleSpanX,
    visibleSpanY,
    cameraMotion,
    trajectory,
    events,
    activity,
    impactTimes,
    cameraCuts,
    previewZoomScale,
    currentWebcam,
    overlayFrame,
    currentClip,
    selectedCursor,
    clickTimes,
    vw,
    vh,
  };
}
