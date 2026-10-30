import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Operation } from "../editor/types";

export type WorkspaceMode = "recorder" | "editor";

export function useWorkspaceFlow(
  desktop: boolean,
  operation: Operation,
  setError: (message: string) => void,
) {
  const [mode, setMode] = useState<WorkspaceMode>("recorder");
  const windowQueue = useRef(Promise.resolve());
  const showEditor = useCallback(() => setMode("editor"), []);
  const showRecorder = useCallback(() => setMode("recorder"), []);
  const recording = [
    "starting",
    "recording",
    "pausing",
    "paused",
    "stopping",
  ].includes(operation);
  const windowMode =
    mode === "editor" ? "editor" : recording ? "recording" : "recorder";
  useEffect(() => {
    if (!desktop) return;
    windowQueue.current = windowQueue.current
      .catch(() => undefined)
      .then(() => invoke<void>("set_workspace_mode", { mode: windowMode }))
      .catch((cause) => setError(String(cause)));
  }, [desktop, windowMode, setError]);
  const windowAction = (action: "drag" | "minimize" | "close") => {
    if (desktop)
      void invoke("workspace_window_action", { action }).catch((cause) =>
        setError(String(cause)),
      );
  };
  const prepareRecording = async () => {
    if (!desktop) return;
    const prepared = windowQueue.current
      .catch(() => undefined)
      .then(() => invoke<void>("set_workspace_mode", { mode: "recording" }));
    windowQueue.current = prepared;
    await prepared;
  };
  return { mode, showEditor, showRecorder, windowAction, prepareRecording };
}
