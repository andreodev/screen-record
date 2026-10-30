import { useEffect, useRef, useState } from "react";
import type { Media, Panel } from "./types";
import type { WebcamKeyframe } from "../webcam";

export function usePreviewSession(
  panel: Panel,
  media: Media | null,
  workspaceMode: "recorder" | "editor",
) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [previewQuality, setPreviewQuality] = useState(1);
  const [previewScale, setPreviewScale] = useState(1);
  const [reelMode, setReelMode] = useState(false);
  const [areaSize, setAreaSize] = useState({ width: 700, height: 400 });
  const [webcamSourceAspect, setWebcamSourceAspect] = useState(16 / 9);
  const [webcamClipboard, setWebcamClipboard] = useState<WebcamKeyframe | null>(
    null,
  );
  const [webcamKeyTimeDraft, setWebcamKeyTimeDraft] = useState<number | null>(
    null,
  );
  const video = useRef<HTMLVideoElement>(null);
  const videoViewport = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const microphoneAudio = useRef<HTMLAudioElement>(null);
  const clickSoundAudio = useRef<HTMLAudioElement>(null);
  const webcamVideo = useRef<HTMLVideoElement>(null);
  const webcamContainer = useRef<HTMLDivElement>(null);
  const webcamVisual = useRef<HTMLDivElement>(null);
  const plane = useRef<HTMLDivElement>(null);
  const cursor = useRef<HTMLDivElement>(null);
  const clickRing = useRef<HTMLDivElement>(null);
  const qualityCanvas = useRef<HTMLCanvasElement>(null);
  const videoBackground = useRef<HTMLCanvasElement>(null);
  const motionCanvas = useRef<HTMLCanvasElement>(null);
  const focusMarker = useRef<HTMLButtonElement>(null);
  const motionSample = useRef<HTMLCanvasElement | null>(null);
  const cursorImages = useRef(new Map<string, HTMLImageElement>());
  const scene = useRef<HTMLDivElement>(null);
  const previewArea = useRef<HTMLDivElement>(null);
  const inspector = useRef<HTMLElement>(null);
  const mediaRef = useRef(media);
  mediaRef.current = media;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const lastClickSoundTime = useRef<number | null>(null);
  const viewportRef = useRef({ width: 700, height: 400 });
  const pendingSeek = useRef(0);

  useEffect(() => {
    if (inspector.current) inspector.current.scrollTop = 0;
  }, [panel]);

  useEffect(() => {
    const element = previewArea.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setAreaSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [workspaceMode]);

  return {
    time,
    setTime,
    playing,
    setPlaying,
    rate,
    setRate,
    previewQuality,
    setPreviewQuality,
    previewScale,
    setPreviewScale,
    reelMode,
    setReelMode,
    areaSize,
    webcamSourceAspect,
    setWebcamSourceAspect,
    webcamClipboard,
    setWebcamClipboard,
    webcamKeyTimeDraft,
    setWebcamKeyTimeDraft,
    video,
    videoViewport,
    audio,
    microphoneAudio,
    clickSoundAudio,
    webcamVideo,
    webcamContainer,
    webcamVisual,
    plane,
    cursor,
    clickRing,
    qualityCanvas,
    videoBackground,
    motionCanvas,
    focusMarker,
    motionSample,
    cursorImages,
    scene,
    previewArea,
    inspector,
    mediaRef,
    playingRef,
    lastClickSoundTime,
    viewportRef,
    pendingSeek,
  };
}
