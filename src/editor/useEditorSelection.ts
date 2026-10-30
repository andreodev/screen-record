import { useState } from "react";
import type { Panel } from "./types";

export function useEditorSelection() {
  const [panel, setPanel] = useState<Panel>("background");
  const [selectedClip, setSelectedClip] = useState<number | null>(null);
  const [selectedEffect, setSelectedEffect] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  return {
    panel,
    setPanel,
    selected,
    setSelected,
    selectedClip,
    setSelectedClip,
    selectedEffect,
    setSelectedEffect,
  };
}
