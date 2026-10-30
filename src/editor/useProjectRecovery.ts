import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Media, Operation, Project } from "./types";

type ProjectRecoveryOptions = {
  desktop: boolean;
  operation: Operation;
  project: Project | null;
  projectPath: string;
  busy: boolean;
  load: (media: Media, project?: Project, path?: string) => void;
  setNotice: (message: string) => void;
  setError: (message: string) => void;
};

export function useProjectRecovery({
  desktop,
  operation,
  project,
  projectPath,
  busy,
  load,
  setNotice,
  setError,
}: ProjectRecoveryOptions) {
  useEffect(() => {
    if (!desktop || operation !== "idle") return;
    void invoke<{ media: Media; project: Project; path: string } | null>(
      "take_pending_project",
    )
      .then((result) => {
        if (result) {
          load(result.media, result.project, result.path);
          if ("recovered" in result && result.recovered)
            setNotice(
              "Projeto recuperado do backup. O manifesto danificado foi preservado no pacote.",
            );
        }
      })
      .catch((e) => setError(String(e)));
  }, [desktop, operation, load]);
  useEffect(() => {
    if (!desktop || !project || !projectPath || busy) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void invoke<string | null>("autosave_project", { project })
        .then((path) => {
          if (active && path)
            setNotice(`Salvo automaticamente · ${path.split("/").pop()}`);
        })
        .catch((e) => {
          if (active)
            setError(`Não foi possível salvar automaticamente: ${String(e)}`);
        });
    }, 700);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [desktop, project, projectPath, busy]);
}
