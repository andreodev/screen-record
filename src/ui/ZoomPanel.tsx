import type { Media, Project } from "../editor/types";
import {
  regenerateAutoZooms,
  clamp,
  type Appearance,
  type Zoom,
} from "../zoom";
import { RangeField as Range } from "./RangeField";

type ZoomPanelProps = {
  cameraMode: NonNullable<Appearance["cameraMode"]>;
  setCameraMode: (mode: NonNullable<Appearance["cameraMode"]>) => void;
  look: Appearance;
  appearance: (patch: Partial<Appearance>) => void;
  media: Media | null;
  edit: (update: (project: Project) => Project) => void;
  setSelected: (id: string | null) => void;
  addZoom: (time?: number) => void;
  currentZoom: Zoom | null | undefined;
  zoomChange: (patch: Partial<Zoom>) => void;
  selected: string | null;
};

export function ZoomPanel({
  cameraMode,
  setCameraMode,
  look,
  appearance,
  media,
  edit,
  setSelected,
  addZoom,
  currentZoom,
  zoomChange,
  selected,
}: ZoomPanelProps) {
  return (
    <>
      <div className="panel-title">
        <h2>Zoom automático</h2>
        <span>
          {cameraMode === "hybrid"
            ? "Automático, com edição manual"
            : cameraMode === "auto"
              ? "Foco gerado pelas interações"
              : "Enquadramento manual"}
        </span>
      </div>
      <div
        className="segmented camera-modes"
        role="group"
        aria-label="Modo de câmera"
      >
        {(
          [
            ["auto", "Auto"],
            ["manual", "Manual"],
            ["hybrid", "Híbrido"],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            className={cameraMode === mode ? "active" : ""}
            aria-pressed={cameraMode === mode}
            onClick={() => setCameraMode(mode)}
          >
            {label}
          </button>
        ))}
      </div>
      {cameraMode !== "manual" && (
        <p className="help">
          Cliques e trechos de digitação geram foco automaticamente, com
          transições suaves. Durante a digitação, o foco permanece no campo
          selecionado.
        </p>
      )}
      <div className="motion-options">
        <button
          className={!look.smooth ? "active" : ""}
          onClick={() => appearance({ smooth: false })}
        >
          ◎ Focado
        </button>
        <button
          className={look.smooth ? "active" : ""}
          onClick={() => appearance({ smooth: true })}
        >
          〰 Suave
        </button>
      </div>
      <button
        className="wide subtle"
        disabled={!media?.cursorCaptured}
        onClick={() => {
          if (media) {
            edit((p) => ({
              ...p,
              zooms: regenerateAutoZooms(p.zooms, media.cursor, media.duration),
            }));
            setSelected(null);
          }
        }}
      >
        Recalcular zooms automáticos
      </button>
      {!media?.cursorCaptured && (
        <p className="help">
          Vídeos importados sem eventos de cursor usam zoom manual.
        </p>
      )}
      <button className="wide subtle" onClick={() => addZoom()}>
        ＋ Adicionar zoom aqui
      </button>
      {currentZoom ? (
        <>
          <div className="section-line" />
          <h3>Zoom selecionado</h3>
          <label className="switch-label">
            Seguir cursor
            <input
              type="checkbox"
              disabled={!media?.cursorCaptured}
              checked={currentZoom.follow || false}
              onChange={(e) => zoomChange({ follow: e.target.checked })}
            />
          </label>
          <label className="switch-label">
            Zoom instantâneo
            <input
              type="checkbox"
              checked={currentZoom.instant ?? false}
              onChange={(e) => zoomChange({ instant: e.target.checked })}
            />
          </label>
          <label className="switch-label">
            Ativo
            <input
              type="checkbox"
              checked={currentZoom.enabled}
              onChange={(e) => zoomChange({ enabled: e.target.checked })}
            />
          </label>
          <Range
            label="Ampliação"
            min={1}
            max={3}
            step={0.05}
            value={currentZoom.scale}
            suffix="×"
            onChange={(scale) => zoomChange({ scale })}
          />
          <Range
            label="Posição horizontal"
            min={0}
            max={1}
            step={0.01}
            value={currentZoom.x}
            onChange={(x) => zoomChange({ x })}
          />
          <Range
            label="Posição vertical"
            min={0}
            max={1}
            step={0.01}
            value={currentZoom.y}
            onChange={(y) => zoomChange({ y })}
          />
          <div className="time-inputs">
            <label>
              Início
              <input
                aria-label="Início do zoom"
                type="number"
                min={0}
                max={currentZoom.end - 0.1}
                step={0.1}
                value={Number(currentZoom.start.toFixed(2))}
                onChange={(e) =>
                  zoomChange({
                    start: clamp(
                      Number(e.target.value),
                      0,
                      currentZoom.end - 0.1,
                    ),
                  })
                }
              />
            </label>
            <label>
              Fim
              <input
                aria-label="Fim do zoom"
                type="number"
                min={currentZoom.start + 0.1}
                max={media?.duration}
                step={0.1}
                value={Number(currentZoom.end.toFixed(2))}
                onChange={(e) =>
                  zoomChange({
                    end: clamp(
                      Number(e.target.value),
                      currentZoom.start + 0.1,
                      media?.duration || 1,
                    ),
                  })
                }
              />
            </label>
          </div>
          <p className="help">
            Clique na prévia para escolher o foco. Os zooms entram e saem
            suavemente.
          </p>
          <button
            className="wide danger"
            onClick={() => {
              edit((p) => ({
                ...p,
                zooms: p.zooms.filter((z) => z.id !== selected),
              }));
              setSelected(null);
            }}
          >
            Remover zoom
          </button>
        </>
      ) : (
        <p className="help">
          Selecione um bloco roxo na timeline para ajustar duração, intensidade
          e foco.
        </p>
      )}
    </>
  );
}
