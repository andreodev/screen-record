import type { Appearance, CursorEvent, Zoom } from "../zoom";
import type { Webcam } from "../webcam";
import type { Clip, Effect } from "../timeline";

export type Media = {
  path: string;
  duration: number;
  width: number;
  height: number;
  cursor: CursorEvent[];
  cursorCaptured: boolean;
  hasAudio?: boolean;
  webcamPath?: string;
  microphonePath?: string;
};

export type Project = {
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
  name: string;
  mediaPath: string;
  zooms: Zoom[];
  trim: Clip;
  clips?: Clip[];
  effects?: Effect[];
  backgroundAudio?: { path: string; volume: number };
  microphone?: { path: string; volume: number };
  sourceVolume?: number;
  webcam?: Webcam;
  appearance: Appearance;
};

export type Operation =
  | "idle"
  | "opening"
  | "saving"
  | "starting"
  | "recording"
  | "pausing"
  | "paused"
  | "stopping"
  | "exporting";

export type Panel =
  | "background"
  | "zoom"
  | "cursor"
  | "animations"
  | "clip"
  | "effect"
  | "audio"
  | "pacing"
  | "webcam";
