import { invoke } from "@tauri-apps/api/core";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { Operation } from "./types";

export function useNativeAction(
  setError: Dispatch<SetStateAction<string>>,
  setOperation: Dispatch<SetStateAction<Operation>>,
) {
  return useCallback(
    async function action<T>(
      name: string,
      args?: Record<string, unknown>,
    ): Promise<T | undefined> {
      setError("");
      try {
        return await invoke<T>(name, args);
      } catch (cause) {
        setError(String(cause));
        setOperation("idle");
      }
    },
    [setError, setOperation],
  );
}
