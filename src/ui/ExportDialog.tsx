import type { RefObject } from "react";
import type { CropRect } from "../crop";
import type { Appearance } from "../zoom";
import type { Media } from "../editor/types";
import { exportDimensions } from "../editor/project-utils";
import { AppIcon } from "./AppIcon";

type ExportDialogProps = {
  dialogRef: RefObject<HTMLDialogElement | null>;
  appearance: Appearance;
  media: Media | null;
  sourceCrop: CropRect;
  resolution: number;
  setResolution: (value: number) => void;
  codec: string;
  setCodec: (value: string) => void;
  codecLabels: Record<string, string>;
  quality: string;
  setQuality: (value: string) => void;
  fps: number;
  setFps: (value: number) => void;
  busy: boolean;
  hasProject: boolean;
  onExport: () => void;
};

export function ExportDialog({
  dialogRef: exportDialog,
  appearance: look,
  media,
  sourceCrop,
  resolution: exportResolution,
  setResolution: setExportResolution,
  codec: exportCodec,
  setCodec: setExportCodec,
  codecLabels: exportCodecLabels,
  quality: exportQuality,
  setQuality: setExportQuality,
  fps: exportFps,
  setFps: setExportFps,
  busy,
  hasProject,
  onExport: exportVideo,
}: ExportDialogProps) {
  return (
    <dialog
      className="export-dialog"
      ref={exportDialog}
      aria-labelledby="export-title"
    >
      <form
        method="dialog"
        onSubmit={(e) => {
          e.preventDefault();
          exportDialog.current?.close();
          void exportVideo();
        }}
      >
        <div className="export-heading">
          <span className="export-heading-icon">
            <AppIcon name="export" />
          </span>
          <div>
            <h2 id="export-title">Exportar vídeo</h2>
            <p>Escolha a qualidade do arquivo final</p>
          </div>
          <button
            type="button"
            className="export-close"
            aria-label="Fechar"
            onClick={() => exportDialog.current?.close()}
          >
            ×
          </button>
        </div>
        <section className="export-section" aria-labelledby="resolution-title">
          <div className="export-section-title">
            <strong id="resolution-title">Resolução</strong>
            <span>
              {exportDimensions(
                exportResolution,
                look.aspect,
                media,
                sourceCrop,
              )}{" "}
              px
            </span>
          </div>
          <div
            className="export-choice-grid"
            role="group"
            aria-label="Resolução de exportação"
          >
            {[
              [480, "SD", "Arquivo leve"],
              [720, "HD", "Boa qualidade"],
              [1080, "Full HD", "Recomendado"],
              [1440, "QHD", "Alta definição"],
              [2160, "4K", "Máximo detalhe"],
            ].map(([value, label, detail]) => (
              <button
                type="button"
                key={value}
                className={exportResolution === value ? "selected" : ""}
                aria-pressed={exportResolution === value}
                onClick={() => setExportResolution(Number(value))}
              >
                <strong>{label}</strong>
                <span>{value}p</span>
                <small>{detail}</small>
              </button>
            ))}
          </div>
        </section>
        <label className="capture-device-select">
          <span>Formato</span>
          <select
            aria-label="Formato de exportação"
            value={exportCodec}
            onChange={(event) => setExportCodec(event.target.value)}
          >
            {Object.entries(exportCodecLabels).map(([codec, label]) => (
              <option key={codec} value={codec}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {!exportCodec.startsWith("prores") && (
          <label className="capture-device-select">
            <span>Qualidade</span>
            <select
              aria-label="Qualidade da exportação"
              value={exportQuality}
              onChange={(event) => setExportQuality(event.target.value)}
            >
              <option value="web">Web · arquivo menor</option>
              <option value="balanced">Equilibrada</option>
              <option value="high">Alta</option>
            </select>
          </label>
        )}
        <section className="export-section">
          <div className="export-section-title">
            <strong>Quadros por segundo</strong>
            <span>Movimento</span>
          </div>
          <div
            className="export-fps-grid"
            role="group"
            aria-label="Quadros por segundo"
          >
            {[
              [24, "Cinema"],
              [30, "Padrão"],
              [60, "Fluido"],
            ].map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={exportFps === value ? "selected" : ""}
                aria-pressed={exportFps === value}
                onClick={() => setExportFps(Number(value))}
              >
                <strong>{value} fps</strong>
                <small>{label}</small>
              </button>
            ))}
          </div>
        </section>
        <div className="export-summary">
          <span className="export-summary-dot" />
          <span>
            <strong>{exportCodecLabels[exportCodec]}</strong>
            <small>
              Proporção {look.aspect === "auto" ? "original" : look.aspect} ·
              aparência, zooms e cursor incluídos
            </small>
          </span>
        </div>
        <div className="export-dialog-actions">
          <button type="button" onClick={() => exportDialog.current?.close()}>
            Cancelar
          </button>
          <button
            className="export-button"
            type="submit"
            disabled={!hasProject || busy}
          >
            Exportar vídeo{" "}
            <span>
              {exportResolution === 2160 ? "4K" : `${exportResolution}p`} ·{" "}
              {exportFps} fps
            </span>
          </button>
        </div>
      </form>
    </dialog>
  );
}
