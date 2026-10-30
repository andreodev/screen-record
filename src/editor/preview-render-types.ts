import type {
  Dispatch,
  MutableRefObject,
  RefObject,
  SetStateAction,
} from "react";
import type { CropRect } from "../crop";
import type { Clip } from "../timeline";
import type { Appearance, CameraKey, CursorEvent, Zoom } from "../zoom";
import type { Media, Panel, Project } from "./types";
type TimelineClip = Clip & { index: number };
type Size = { width: number; height: number };
type Viewport = { width: number; height: number };
export type PreviewRendererOptions = {
  trajectory: CameraKey[];
  impactTimes: number[];
  events: CursorEvent[];
  clickTimes: number[];
  activity: number[];
  assetRoot: string;
  sourceCrop: CropRect;
  ranges: TimelineClip[];
  cameraCuts: number[];
  currentZoom: Zoom | null | undefined;
  visibleSpanX: number;
  visibleSpanY: number;
  size: Size;
  previewQuality: number;
  viewportRef: MutableRefObject<Viewport>;
  vw: number;
  vh: number;
  projectRef: MutableRefObject<Project | null>;
  mediaRef: MutableRefObject<Media | null>;
  webcamContainer: RefObject<HTMLDivElement | null>;
  webcamVisual: RefObject<HTMLDivElement | null>;
  webcamVideo: RefObject<HTMLVideoElement | null>;
  scene: RefObject<HTMLDivElement | null>;
  video: RefObject<HTMLVideoElement | null>;
  lastClickSoundTime: MutableRefObject<number | null>;
  playingRef: MutableRefObject<boolean>;
  clickSoundAudio: RefObject<HTMLAudioElement | null>;
  videoViewport: RefObject<HTMLDivElement | null>;
  plane: RefObject<HTMLDivElement | null>;
  cursor: RefObject<HTMLDivElement | null>;
  clickRing: RefObject<HTMLDivElement | null>;
  focusMarker: RefObject<HTMLButtonElement | null>;
  cursorImages: MutableRefObject<Map<string, HTMLImageElement>>;
  motionCanvas: RefObject<HTMLCanvasElement | null>;
  videoBackground: RefObject<HTMLCanvasElement | null>;
  qualityCanvas: RefObject<HTMLCanvasElement | null>;
  motionSample: MutableRefObject<HTMLCanvasElement | null>;
  look: Appearance;
  time: number;
  project: Project | null;
  selected: string | null;
  panel: Panel;
  playing: boolean;
  setTime: Dispatch<SetStateAction<number>>;
  setPlaying: Dispatch<SetStateAction<boolean>>;
  rate: number;
  microphoneAudio: RefObject<HTMLAudioElement | null>;
  audio: RefObject<HTMLAudioElement | null>;
};

export type PreviewRenderData = Pick<
  PreviewRendererOptions,
  | "trajectory"
  | "impactTimes"
  | "events"
  | "clickTimes"
  | "activity"
  | "assetRoot"
  | "sourceCrop"
  | "ranges"
  | "cameraCuts"
  | "currentZoom"
  | "visibleSpanX"
  | "visibleSpanY"
> & { sceneWidth: number; sceneHeight: number; quality: number };
