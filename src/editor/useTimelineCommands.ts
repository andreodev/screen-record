import {
  useCallback,
  useEffect,
  type Dispatch,
  type SetStateAction,
  type RefObject,
} from "react";
import {
  clipRanges,
  editedDuration,
  editedToSource,
  sourceToEdited,
  splitClip,
} from "../timeline";
import type { Media, Operation, Panel, Project } from "./types";

type Setter<T> = Dispatch<SetStateAction<T>>;
type TimelineCommandsOptions = {
  projectRef: RefObject<Project | null>;
  mediaRef: RefObject<Media | null>;
  operationRef: RefObject<Operation>;
  video: RefObject<HTMLVideoElement | null>;
  edit: (update: (project: Project) => Project) => void;
  setNotice: Setter<string>;
  setSelected: Setter<string | null>;
  setSelectedClip: Setter<number | null>;
  setSelectedEffect: Setter<string | null>;
  setPanel: Setter<Panel>;
  selected: string | null;
  selectedClip: number | null;
  selectedEffect: string | null;
  webcamKeyed: boolean;
  toggleWebcamKeyframe: () => void;
  setTime: Setter<number>;
  draw: (time: number) => void;
  togglePlay: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  seek: (time: number) => void;
  undoShortcut: string;
};

export function useTimelineCommands({
  projectRef,
  mediaRef,
  operationRef,
  video,
  edit,
  setNotice,
  setSelected,
  setSelectedClip,
  setSelectedEffect,
  setPanel,
  selected,
  selectedClip,
  selectedEffect,
  webcamKeyed,
  toggleWebcamKeyframe,
  setTime,
  draw,
  togglePlay,
  undo,
  redo,
  seek,
  undoShortcut,
}: TimelineCommandsOptions) {
  const splitAtPlayhead = useCallback(() => {
    const p = projectRef.current,
      m = mediaRef.current;
    if (!p || !m || operationRef.current !== "idle") return;
    video.current?.pause();
    const t = video.current?.currentTime ?? 0;
    if (
      !clipRanges(p.trim, p.clips).some(
        (clip) => t - clip.start >= 0.1 && clip.end - t >= 0.1,
      )
    ) {
      setNotice(
        "Posicione o marcador a pelo menos 0,1 segundo das bordas para dividir.",
      );
      return;
    }
    const next = splitClip(p.clips ?? [{ start: 0, end: m.duration }], t);
    if (!next) return;
    edit((p) => ({
      ...p,
      version: p.version >= 4 ? p.version : 3,
      clips: next,
    }));
    setSelected(null);
    setSelectedClip(
      next.findIndex((clip) => Math.abs(clip.start - t) < 0.000001),
    );
    setSelectedEffect(null);
    setPanel("clip");
    setNotice("Trecho dividido. Selecione uma parte para apagar.");
  }, [edit]);
  const deleteSelection = useCallback(() => {
    const p = projectRef.current;
    if (!p || operationRef.current !== "idle") return;
    video.current?.pause();
    if (selected) {
      edit((p) => ({ ...p, zooms: p.zooms.filter((z) => z.id !== selected) }));
      setSelected(null);
      setNotice(`Zoom removido. ${undoShortcut} desfaz.`);
      return;
    }
    if (selectedEffect) {
      edit((p) => ({
        ...p,
        version: 5,
        effects: (p.effects ?? []).filter(
          (effect) => effect.id !== selectedEffect,
        ),
      }));
      setSelectedEffect(null);
      setNotice(`Máscara ou destaque removido. ${undoShortcut} desfaz.`);
      return;
    }
    if (webcamKeyed) {
      toggleWebcamKeyframe();
      setNotice(`Ajuste da webcam removido. ${undoShortcut} desfaz.`);
      return;
    }
    if (selectedClip === null) return;
    const clips = (
      p.clips ?? [{ start: 0, end: mediaRef.current!.duration }]
    ).filter((_, index) => index !== selectedClip);
    const kept = clipRanges(p.trim, clips);
    if (editedDuration(kept) < 0.1) {
      setNotice(
        "Mantenha pelo menos 0,1 segundo de vídeo. Divida o trecho antes de apagar.",
      );
      return;
    }
    edit((p) => ({ ...p, clips }));
    setSelectedClip(null);
    const next = editedToSource(
      sourceToEdited(video.current?.currentTime ?? 0, kept),
      kept,
    );
    if (video.current) video.current.currentTime = next;
    setTime(next);
    draw(next);
    setNotice(`Trecho apagado da edição. ${undoShortcut} desfaz.`);
  }, [
    selected,
    selectedClip,
    selectedEffect,
    webcamKeyed,
    edit,
    draw,
    toggleWebcamKeyframe,
  ]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      const target = e.target as HTMLElement;
      if (
        ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName) ||
        target.isContentEditable
      )
        return;
      if (operationRef.current !== "idle") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        splitAtPlayhead();
        return;
      }
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        (selected || selectedClip !== null || selectedEffect || webcamKeyed)
      ) {
        e.preventDefault();
        deleteSelection();
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        void togglePlay();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if (
        (e.key === "ArrowRight" || e.key === "ArrowLeft") &&
        projectRef.current
      ) {
        e.preventDefault();
        const kept = clipRanges(
          projectRef.current.trim,
          projectRef.current.clips,
        );
        const offset = e.key === "ArrowRight" ? 1 / 30 : -1 / 30;
        seek(
          editedToSource(
            sourceToEdited(video.current?.currentTime || 0, kept) + offset,
            kept,
          ),
        );
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    togglePlay,
    redo,
    undo,
    seek,
    splitAtPlayhead,
    deleteSelection,
    selected,
    selectedClip,
    selectedEffect,
    webcamKeyed,
  ]);
  return { splitAtPlayhead, deleteSelection };
}
