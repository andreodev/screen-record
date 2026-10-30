import type { PreviewBindings } from "./types";
import { AppIcon } from "../AppIcon";

export type PreviewToolbarProps = Pick<
  PreviewBindings,
  | "look"
  | "project"
  | "busy"
  | "appearance"
  | "cropFill"
  | "video"
  | "setCropOpen"
  | "reelMode"
  | "setReelMode"
  | "visibleSpanX"
  | "visibleSpanY"
  | "followCropCursor"
  | "media"
  | "previewQuality"
  | "setPreviewQuality"
  | "previewScale"
  | "setPreviewScale"
  | "recordWebcam"
  | "desktop"
  | "setRecordWebcam"
  | "setPanel"
  | "recordMicrophone"
  | "setRecordMicrophone"
  | "recordSystemAudio"
  | "setRecordSystemAudio"
  | "onNewRecording"
>;

export function PreviewToolbar({
  look,
  project,
  busy,
  appearance,
  cropFill,
  video,
  setCropOpen,
  reelMode,
  setReelMode,
  visibleSpanX,
  visibleSpanY,
  followCropCursor,
  media,
  previewQuality,
  setPreviewQuality,
  previewScale,
  setPreviewScale,
  recordWebcam,
  desktop,
  setRecordWebcam,
  setPanel,
  recordMicrophone,
  setRecordMicrophone,
  recordSystemAudio,
  setRecordSystemAudio,
  onNewRecording,
}: PreviewToolbarProps) {
  return (
    <div className="preview-toolbar">
      <label>
        <AppIcon name="record" />
        <select
          aria-label="Proporção do vídeo"
          value={look.aspect}
          disabled={!project || busy}
          onChange={(e) => appearance({ aspect: e.target.value })}
        >
          <option value="auto">Auto</option>
          <option>16:9</option>
          <option value="9:16">Vertical 9:16</option>
          <option>1:1</option>
        </select>
      </label>
      <button
        className={look.crop || cropFill ? "toolbar-active" : ""}
        disabled={!project || busy}
        aria-haspopup="dialog"
        title="Selecionar a área do vídeo para recortar"
        onClick={() => {
          video.current?.pause();
          setCropOpen(true);
        }}
      >
        ⌗ Crop
      </button>
      <button
        className={reelMode ? "toolbar-active" : ""}
        disabled={!project || busy}
        aria-pressed={reelMode}
        onClick={() => setReelMode((value) => !value)}
      >
        ▣ Reel mode
      </button>
      {look.aspect === "9:16" &&
        cropFill &&
        (visibleSpanX < 0.999 || visibleSpanY < 0.999) && (
          <button
            className={followCropCursor ? "toolbar-active" : ""}
            disabled={!project || busy || !media?.cursorCaptured}
            aria-pressed={followCropCursor}
            title="A câmera move o recorte vertical suavemente para acompanhar o cursor"
            onClick={() => appearance({ cropFollowCursor: !followCropCursor })}
          >
            ↝ Acompanhar cursor
          </button>
        )}
      <label className="preview-quality">
        ✺ Preview quality{" "}
        <select
          aria-label="Qualidade da prévia"
          value={previewQuality}
          onChange={(e) => setPreviewQuality(Number(e.target.value))}
        >
          <option value={1}>Full</option>
          <option value={0.5}>Half</option>
          <option value={0.25}>Quarter</option>
        </select>
      </label>
      <button
        className="preview-zoom-button"
        disabled={previewScale <= 0.6}
        aria-label="Diminuir zoom da prévia"
        title="Diminuir zoom da prévia"
        onClick={() => setPreviewScale((value) => Math.max(0.6, value - 0.1))}
      >
        −
      </button>
      <button
        className="preview-zoom-button"
        disabled={previewScale >= 1.4}
        aria-label="Aumentar zoom da prévia"
        title="Aumentar zoom da prévia"
        onClick={() => setPreviewScale((value) => Math.min(1.4, value + 0.1))}
      >
        ＋
      </button>
      <button
        className={`toolbar-button ${recordWebcam ? "toolbar-active" : ""}`}
        disabled={!desktop || busy}
        aria-pressed={recordWebcam}
        onClick={() => {
          setRecordWebcam((v) => !v);
          setPanel("webcam");
        }}
        title="Incluir webcam na próxima gravação"
      >
        ◉ Webcam {recordWebcam ? "ativa" : "desativada"}
      </button>
      <button
        className={`toolbar-button ${recordMicrophone ? "toolbar-active" : ""}`}
        disabled={!desktop || busy}
        aria-label="Gravar microfone"
        aria-pressed={recordMicrophone}
        title={`Microfone ${recordMicrophone ? "ligado" : "desligado"} · próxima gravação`}
        onClick={() => setRecordMicrophone((v) => !v)}
      >
        🎙
      </button>
      <button
        className={`toolbar-button ${recordSystemAudio ? "toolbar-active" : ""}`}
        disabled={!desktop || busy}
        aria-label="Gravar áudio do sistema"
        aria-pressed={recordSystemAudio}
        title={`Áudio do sistema ${recordSystemAudio ? "ligado" : "desligado"} · próxima gravação`}
        onClick={() => setRecordSystemAudio((v) => !v)}
      >
        ♫
      </button>
      <button
        className="new-recording"
        disabled={!desktop || busy}
        onClick={onNewRecording}
      >
        <span className="red-dot" />
        Nova gravação
      </button>
    </div>
  );
}
