import { useRef, useState } from "react";

export const exportCodecLabels: Record<string, string> = {
  h264: "MP4 · H.264",
  hevc: "MP4 · HEVC",
  "prores-lt": "MOV · ProRes 422 LT",
  prores: "MOV · ProRes 422",
  "prores-hq": "MOV · ProRes 422 HQ",
  "prores-4444": "MOV · ProRes 4444",
};

export function useExportSettings() {
  const exportDialog = useRef<HTMLDialogElement>(null);
  const [exportCodec, setExportCodec] = useState("h264");
  const [exportQuality, setExportQuality] = useState("high");
  const [exportResolution, setExportResolution] = useState(2160);
  const [exportFps, setExportFps] = useState(60);
  return {
    exportDialog,
    exportCodec,
    setExportCodec,
    exportQuality,
    setExportQuality,
    exportResolution,
    setExportResolution,
    exportFps,
    setExportFps,
    exportCodecLabels,
  };
}
