import {
  useCallback,
  useEffect,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
  type SetStateAction,
} from "react";
import { playMedia, playbackInterrupted } from "../playback";
import {
  clipRanges,
  clipSpeed,
  editedToSource,
  sourceToEdited,
} from "../timeline";
import type { Operation, Project } from "./types";

type PlaybackOptions = {
  project: Project | null;
  projectRef: MutableRefObject<Project | null>;
  operationRef: MutableRefObject<Operation>;
  video: RefObject<HTMLVideoElement | null>;
  webcamVideo: RefObject<HTMLVideoElement | null>;
  microphoneAudio: RefObject<HTMLAudioElement | null>;
  audio: RefObject<HTMLAudioElement | null>;
  clickSoundAudio: RefObject<HTMLAudioElement | null>;
  lastClickSoundTime: MutableRefObject<number | null>;
  setTime: Dispatch<SetStateAction<number>>;
  setError: Dispatch<SetStateAction<string>>;
  draw: (time: number) => void;
  rate: number;
  setRate: Dispatch<SetStateAction<number>>;
};

export function usePlaybackControls(options: PlaybackOptions) {
  const {
    project,
    projectRef,
    operationRef,
    video,
    webcamVideo,
    microphoneAudio,
    audio,
    clickSoundAudio,
    lastClickSoundTime,
    setTime,
    setError,
    draw,
    rate,
  } = options;
  const seek = useCallback(
    (t: number) => {
      const p = projectRef.current;
      if (!p) return;
      const kept = clipRanges(p.trim, p.clips);
      const next = editedToSource(sourceToEdited(t, kept), kept);
      lastClickSoundTime.current = next;
      if (video.current) video.current.currentTime = next;
      if (
        webcamVideo.current &&
        projectRef.current?.webcam &&
        webcamVideo.current.readyState >= 1
      )
        webcamVideo.current.currentTime = next;
      if (microphoneAudio.current?.readyState && p.microphone)
        microphoneAudio.current.currentTime = next;
      if (audio.current?.duration)
        audio.current.currentTime =
          sourceToEdited(next, kept) % audio.current.duration;
      setTime(next);
      draw(next);
    },
    [draw],
  );
  useEffect(() => {
    if (video.current) video.current.volume = project?.sourceVolume ?? 1;
    if (microphoneAudio.current)
      microphoneAudio.current.volume = project?.microphone?.volume ?? 1;
  }, [project?.sourceVolume, project?.microphone?.volume]);
  const togglePlay = useCallback(async () => {
    const element = video.current,
      p = projectRef.current;
    if (!element || !p || operationRef.current !== "idle") return;
    if (element.paused) {
      const kept = clipRanges(p.trim, p.clips);
      if (!kept.length) return;
      if (element.currentTime >= kept[kept.length - 1]!.end - 0.02)
        element.currentTime = kept[0].start;
      else
        element.currentTime = editedToSource(
          sourceToEdited(element.currentTime, kept),
          kept,
        );
      lastClickSoundTime.current = element.currentTime;
      const clip = kept.find(
        (c) => element.currentTime >= c.start && element.currentTime < c.end,
      );
      element.playbackRate = rate * (clip ? clipSpeed(clip) : 1);
      try {
        const clickAudio = clickSoundAudio.current;
        if (clickAudio?.paused) {
          clickAudio.muted = true;
          void clickAudio
            .play()
            .then(() => {
              clickAudio.pause();
              clickAudio.currentTime = 0;
              clickAudio.muted = false;
            })
            .catch(() => {
              clickAudio.muted = false;
            });
        }
        const voice = microphoneAudio.current;
        if (voice && p.microphone) {
          voice.currentTime = element.currentTime;
          voice.playbackRate = element.playbackRate;
        }
        await playMedia(element, (e) => setError(String(e)));
      } catch (e) {
        if (!playbackInterrupted(e)) setError(String(e));
      }
    } else element.pause();
  }, [rate]);
  function changeRate(nextRate: number) {
    options.setRate(nextRate);
    const element = video.current;
    if (!element) return;
    const current = projectRef.current;
    const clip =
      current &&
      clipRanges(current.trim, current.clips).find(
        (item) =>
          element.currentTime >= item.start && element.currentTime < item.end,
      );
    element.playbackRate = nextRate * (clip ? clipSpeed(clip) : 1);
  }
  return { seek, togglePlay, changeRate };
}
