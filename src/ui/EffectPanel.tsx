import { canvasEffect, effectLabels, graphicEffect } from "../annotations";
import type { Media } from "../editor/types";
import { clamp } from "../zoom";
import type { Effect } from "../timeline";
import { RangeField as Range } from "./RangeField";

type EffectPanelProps = {
  currentEffect: Effect | null | undefined;
  importSubtitles: () => void | Promise<void>;
  addEffect: (kind: Effect["kind"]) => void;
  effectChange: (patch: Partial<Effect>) => void;
  media: Media | null;
};

export function EffectPanel({
  currentEffect,
  importSubtitles,
  addEffect,
  effectChange,
  media,
}: EffectPanelProps) {
  return (
    <>
      <div className="panel-title">
        <h2>
          {currentEffect ? effectLabels[currentEffect.kind] : "Anotações"}
        </h2>
        <span>Área e duração do efeito</span>
        <button className="wide subtle" onClick={() => void importSubtitles()}>
          Importar legendas SRT
        </button>
      </div>
      {!currentEffect && (
        <>
          <div className="effect-tools">
            <button
              className="wide subtle"
              onClick={() => addEffect("spotlight")}
            >
              ◉ Spotlight
            </button>
            <button className="wide subtle" onClick={() => addEffect("mask")}>
              ▧ Proteger com blur
            </button>
          </div>
          <p className="help">
            Destaque uma ação com spotlight ou cubra informações com blur.
            Arraste a área na prévia e ajuste a duração na timeline.
          </p>
        </>
      )}
      {currentEffect && (
        <>
          <label className="capture-device-select">
            <span>Tipo de anotação</span>
            <select
              aria-label="Tipo de anotação"
              value={currentEffect.kind}
              onChange={(event) =>
                effectChange({
                  kind: event.target.value as Effect["kind"],
                })
              }
            >
              {Object.entries(effectLabels).map(([kind, label]) => (
                <option key={kind} value={kind}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {["text", "caption", "watermark"].includes(currentEffect.kind) && (
            <label className="annotation-text">
              Texto
              <textarea
                maxLength={500}
                value={currentEffect.text ?? "Seu texto"}
                onChange={(event) => effectChange({ text: event.target.value })}
              />
            </label>
          )}
          {graphicEffect(currentEffect.kind) && (
            <label className="custom-color">
              Cor
              <input
                type="color"
                value={currentEffect.color ?? "#ffd55d"}
                onChange={(event) =>
                  effectChange({ color: event.target.value })
                }
              />
            </label>
          )}
          <p className="help">
            Arraste a área no vídeo para mover e use a alça para redimensionar.{" "}
            {canvasEffect(currentEffect.kind)
              ? "A posição fica fixa no quadro final."
              : "A área acompanha o conteúdo durante os zooms."}
            {" "}Para ajustar a duração, arraste as bordas do efeito na timeline.
          </p>
          {currentEffect.kind === "mask" && (
            <button
              className="wide subtle"
              onClick={() =>
                effectChange({ end: media?.duration ?? currentEffect.end })
              }
            >
              Proteger até o fim do vídeo
            </button>
          )}
          <Range
            label="Largura"
            min={4}
            max={100}
            suffix="%"
            value={currentEffect.width * 100}
            onChange={(width) =>
              effectChange({
                width: width / 100,
                x: clamp(currentEffect.x, width / 200, 1 - width / 200),
              })
            }
          />
          <Range
            label="Altura"
            min={4}
            max={100}
            suffix="%"
            value={currentEffect.height * 100}
            onChange={(height) =>
              effectChange({
                height: height / 100,
                y: clamp(currentEffect.y, height / 200, 1 - height / 200),
              })
            }
          />
          {currentEffect.kind !== "mask" &&
            currentEffect.kind !== "magnifier" && (
              <Range
                label={
                  currentEffect.kind === "spotlight"
                    ? "Escurecimento ao redor"
                    : "Opacidade"
                }
                min={10}
                max={100}
                suffix="%"
                value={currentEffect.opacity * 100}
                onChange={(opacity) => effectChange({ opacity: opacity / 100 })}
              />
            )}
        </>
      )}
    </>
  );
}
