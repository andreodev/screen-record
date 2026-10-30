import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  validCaptureArea,
  type CaptureArea,
  type CaptureKind,
  type CaptureSelection,
  type CaptureSources,
} from "../capture-options";

export function useCaptureSources(desktop: boolean, active: boolean) {
  const [sources, setSources] = useState<CaptureSources>({
    displays: [],
    windows: [],
  });
  const [kind, setKind] = useState<CaptureKind>("display");
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [area, setArea] = useState<CaptureArea>({
    x: 0,
    y: 0,
    width: 640,
    height: 480,
  });
  const [resolution, setResolution] = useState(2160);
  const [fps, setFps] = useState(60);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!desktop) return;
    setLoading(true);
    setError("");
    try {
      const result = await invoke<CaptureSources>("list_capture_sources");
      setSources(result);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setLoading(false);
    }
  }, [desktop]);

  useEffect(() => {
    if (active) void refresh();
  }, [active, refresh]);

  const choices = kind === "window" ? sources.windows : sources.displays;
  const selected =
    sourceId === null
      ? choices[0]
      : choices.find((source) => source.id === sourceId);
  const valid =
    !!selected && (kind !== "area" || validCaptureArea(area, selected));
  const selection: CaptureSelection | null =
    valid && selected
      ? {
          source: {
            kind,
            id: selected.id,
            ...(kind === "area" ? { area } : {}),
          },
          resolution,
          fps,
        }
      : null;
  const changeKind = (next: CaptureKind) => {
    setKind(next);
    setSourceId(null);
  };
  return {
    kind,
    changeKind,
    choices,
    selected,
    setSourceId,
    area,
    setArea,
    resolution,
    setResolution,
    fps,
    setFps,
    loading,
    error,
    refresh,
    selection,
  };
}
