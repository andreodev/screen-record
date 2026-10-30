import type { Operation } from "../editor/types";
import { formatTime } from "../timeline";
import { AppIcon } from "./AppIcon";

export function EmptyPreview({
  disabled,
  onImport,
}: {
  disabled: boolean;
  onImport: () => void | Promise<void>;
}) {
  return (
    <div className="empty-preview">
      <div className="empty-icon">
        <AppIcon name="record" />
      </div>
      <h1>Seu próximo vídeo começa aqui.</h1>
      <p>
        Grave sua tela ou abra um vídeo.
        <br />
        Dê foco ao que importa, com zooms suaves.
      </p>
      <button
        className="light-button"
        disabled={disabled}
        onClick={() => void onImport()}
      >
        <AppIcon name="folder" /> Importar vídeo
      </button>
      <span>Processamento local · sem upload</span>
    </div>
  );
}

type RecordingOverlayProps = {
  operation: Operation;
  elapsed: number;
  resolution: number;
  fps: number;
  hasAudio: boolean;
  onStop: () => void | Promise<void>;
};

export function RecordingOverlay({
  operation,
  elapsed,
  resolution,
  fps,
  hasAudio,
  onStop,
}: RecordingOverlayProps) {
  if (!["recording", "starting", "stopping"].includes(operation)) return null;
  return (
    <div className="operation-overlay">
      <span className="red-dot" />
      <strong>
        {operation === "recording"
          ? "Gravando o monitor principal"
          : operation === "starting"
            ? "Preparando captura…"
            : "Finalizando vídeo…"}
      </strong>
      <span className="record-clock">{formatTime(elapsed)}</span>
      <p>
        Até {resolution === 2160 ? "4K" : "1080p"} · {fps} fps ·{" "}
        {hasAudio ? "com áudio" : "sem áudio"}.
      </p>
      <button
        className="light-button"
        disabled={operation === "stopping"}
        onClick={() => void onStop()}
      >
        ■ Parar gravação
      </button>
    </div>
  );
}
