import type { Media, Project } from "../editor/types";
import type { AudioAnalysis, Suggestion } from "../pacing";
import { formatTime } from "../timeline";
import type { Dispatch, SetStateAction } from "react";

type PacingPanelProps = {
  analyzing: boolean;
  media: Media | null;
  project: Project | null;
  analysis: AudioAnalysis | null;
  suggestions: Suggestion[];
  includedSuggestions: number[];
  setIncludedSuggestions: Dispatch<SetStateAction<number[]>>;
  suggestPacing: (kind: "typing" | "silence") => void | Promise<void>;
  seek: (time: number) => void;
  applyPacing: () => void;
};

export function PacingPanel({
  analyzing,
  media,
  project,
  analysis,
  suggestions,
  includedSuggestions,
  setIncludedSuggestions,
  suggestPacing,
  seek,
  applyPacing,
}: PacingPanelProps) {
  const clock = formatTime;
  return (
    <>
      <div className="panel-title">
        <h2>Ritmo</h2>
        <span>Sugestões locais, editáveis e reversíveis</span>
      </div>
      <button
        className="wide subtle"
        disabled={
          analyzing || !media || (!media.hasAudio && !project?.microphone)
        }
        onClick={() => void suggestPacing("silence")}
      >
        {analyzing ? "Analisando…" : "Detectar silêncios"}
      </button>
      <button
        className="wide subtle"
        disabled={analyzing || !media?.cursor.some((point) => point.typing)}
        onClick={() => void suggestPacing("typing")}
      >
        Acelerar digitação para 2×
      </button>
      <p className="help">
        Silêncios abaixo de −38 dB por pelo menos 0,8 s preservam 150 ms em cada
        borda. A análise usa o microfone quando disponível. Ouça os intervalos
        antes de aplicar.
      </p>
      {analysis && (
        <svg
          className="audio-waveform"
          viewBox="0 0 200 50"
          role="img"
          aria-label="Forma de onda do áudio"
        >
          {Array.from({ length: 100 }, (_, i) => {
            const chunk = analysis.levels.slice(
              Math.floor((i * analysis.levels.length) / 100),
              Math.max(
                Math.floor(((i + 1) * analysis.levels.length) / 100),
                Math.floor((i * analysis.levels.length) / 100) + 1,
              ),
            );
            const peak = Math.max(0, ...chunk),
              height = Math.max(1, Math.min(48, peak * 150));
            return (
              <rect
                key={i}
                x={i * 2}
                y={25 - height / 2}
                width={1}
                height={height}
                fill="#ad91ff"
              />
            );
          })}
        </svg>
      )}
      <div className="pacing-suggestions">
        {suggestions.map((suggestion, index) => (
          <div key={index}>
            <label>
              <input
                type="checkbox"
                checked={includedSuggestions.includes(index)}
                onChange={(event) =>
                  setIncludedSuggestions((current) =>
                    event.target.checked
                      ? [...current, index]
                      : current.filter((i) => i !== index),
                  )
                }
              />
              {suggestion.kind === "silence" ? "Remover" : "2×"} ·{" "}
              {clock(suggestion.start)}–{clock(suggestion.end)}
            </label>
            <button onClick={() => seek(suggestion.start)}>Ouvir / ver</button>
          </div>
        ))}
      </div>
      {!!suggestions.length && (
        <button
          className="wide export-button"
          disabled={!includedSuggestions.length}
          onClick={applyPacing}
        >
          Aplicar {includedSuggestions.length} sugestões
        </button>
      )}
    </>
  );
}
