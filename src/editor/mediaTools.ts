import { invoke } from "@tauri-apps/api/core";
import type {
  Dispatch,
  MutableRefObject,
  RefObject,
  SetStateAction,
} from "react";
import {
  applySuggestions,
  silenceSuggestions,
  typingSuggestions,
  type AudioAnalysis,
  type Suggestion,
} from "../pacing";
import { parseSrt } from "../subtitles";
import { editedDuration, type Clip } from "../timeline";
import type { Media, Panel, Project } from "./types";

type NativeAction = <T>(
  name: string,
  args?: Record<string, unknown>,
) => Promise<T | undefined>;
type TimelineClip = Clip & { index: number };
type MediaToolsOptions = {
  action: NativeAction;
  media: Media | null;
  mediaRef: MutableRefObject<Media | null>;
  project: Project | null;
  analyzing: boolean;
  analysis: AudioAnalysis | null;
  suggestions: Suggestion[];
  includedSuggestions: number[];
  ranges: TimelineClip[];
  video: RefObject<HTMLVideoElement | null>;
  audio: RefObject<HTMLAudioElement | null>;
  edit: (update: (project: Project) => Project) => void;
  seek: (time: number) => void;
  setSelectedEffect: Dispatch<SetStateAction<string | null>>;
  setPanel: Dispatch<SetStateAction<Panel>>;
  setNotice: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
  setAnalyzing: Dispatch<SetStateAction<boolean>>;
  setAnalysis: Dispatch<SetStateAction<AudioAnalysis | null>>;
  setSuggestions: Dispatch<SetStateAction<Suggestion[]>>;
  setIncludedSuggestions: Dispatch<SetStateAction<number[]>>;
};

export function createMediaTools(options: MediaToolsOptions) {
  const {
    action,
    media,
    mediaRef,
    project,
    analyzing,
    analysis,
    suggestions,
    includedSuggestions,
    ranges,
    video,
    audio,
    edit,
    seek,
    setSelectedEffect,
    setPanel,
    setNotice,
    setError,
    setAnalyzing,
    setAnalysis,
    setSuggestions,
    setIncludedSuggestions,
  } = options;

  async function importSubtitles() {
    if (!media || !project) return;
    const content = await action<string | null>("import_subtitles");
    if (!content) return;
    try {
      const captions = parseSrt(content, media.duration);
      edit((value) => ({
        ...value,
        version: 12,
        effects: [...(value.effects ?? []), ...captions],
      }));
      setSelectedEffect(captions[0].id);
      setPanel("effect");
      seek(captions[0].start);
      setNotice(
        `${captions.length} legendas adicionadas. Tempos referem-se ao vídeo original.`,
      );
    } catch (cause) {
      setError(String(cause));
    }
  }

  async function suggestPacing(kind: "silence" | "typing") {
    if (!media || !project || analyzing) return;
    const path = media.path;
    setAnalyzing(true);
    try {
      const audioAnalysis =
        kind === "silence"
          ? (analysis ??
            (await invoke<AudioAnalysis>("analyze_recording_audio")))
          : null;
      if (mediaRef.current?.path !== path) return;
      if (audioAnalysis) setAnalysis(audioAnalysis);
      const next = audioAnalysis
        ? silenceSuggestions(audioAnalysis)
        : typingSuggestions(media.cursor);
      setSuggestions(next);
      setIncludedSuggestions(next.map((_, index) => index));
      setNotice(
        next.length
          ? `${next.length} sugestões. Revise antes de aplicar.`
          : "Nenhum intervalo encontrado.",
      );
    } catch (cause) {
      setError(String(cause));
    } finally {
      setAnalyzing(false);
    }
  }

  function applyPacing() {
    if (!project || !media) return;
    const clips = applySuggestions(
      ranges.map(({ index: _index, ...clip }) => clip),
      suggestions.filter((_, index) => includedSuggestions.includes(index)),
    );
    if (editedDuration(clips) < 0.1) {
      setError(
        "A sugestão removeria todo o vídeo. Desmarque alguns intervalos.",
      );
      return;
    }
    video.current?.pause();
    edit((value) => ({ ...value, version: 12, clips }));
    setSuggestions([]);
    setIncludedSuggestions([]);
    setNotice(
      "Sugestões aplicadas. Use Desfazer para recuperar a edição anterior.",
    );
  }

  async function chooseBackgroundAudio() {
    const path = await action<string | null>("choose_background_audio");
    if (path)
      edit((value) => ({
        ...value,
        version: 6,
        backgroundAudio: { path, volume: 0.25 },
      }));
  }

  function setBackgroundVolume(volume: number) {
    edit((value) => ({
      ...value,
      version: 6,
      backgroundAudio: value.backgroundAudio
        ? { ...value.backgroundAudio, volume }
        : undefined,
    }));
    if (audio.current) audio.current.volume = volume;
  }

  return {
    importSubtitles,
    suggestPacing,
    applyPacing,
    chooseBackgroundAudio,
    setBackgroundVolume,
  };
}
