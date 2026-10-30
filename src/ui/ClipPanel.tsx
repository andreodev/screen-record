import type { Clip } from "../timeline";

type ClipPanelProps = {
  currentClip: Clip | null | undefined;
  selectedClip: number | null;
  clipChange: (patch: Partial<Clip>) => void;
  canEditCursor: boolean;
};

export function ClipPanel({
  currentClip,
  selectedClip,
  clipChange,
  canEditCursor,
}: ClipPanelProps) {
  return (
    <>
      <div className="panel-title">
        <h2>{currentClip ? `Trecho ${selectedClip! + 1}` : "Trecho"}</h2>
        <span>Velocidade e cursor por trecho</span>
      </div>
      {!currentClip && (
        <p className="help">
          Selecione um trecho dourado na timeline para ajustar a velocidade e o
          cursor.
        </p>
      )}
      {currentClip && (
        <>
          <label className="clip-speed">
            Velocidade
            <select
              aria-label="Velocidade do trecho"
              value={currentClip.speed ?? 1}
              onChange={(e) => clipChange({ speed: Number(e.target.value) })}
            >
              {[0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4].map((speed) => (
                <option key={speed} value={speed}>
                  {speed}×
                </option>
              ))}
            </select>
          </label>
          <fieldset disabled={!canEditCursor}>
            <label className="switch-label">
              Ocultar cursor neste trecho
              <input
                type="checkbox"
                checked={currentClip.hideCursor ?? false}
                onChange={(e) => clipChange({ hideCursor: e.target.checked })}
              />
            </label>
            <label className="switch-label">
              Movimento original neste trecho
              <input
                type="checkbox"
                checked={currentClip.cursorOriginal ?? false}
                onChange={(e) =>
                  clipChange({ cursorOriginal: e.target.checked })
                }
              />
            </label>
          </fieldset>
          <p className="help">
            A velocidade e as opções de cursor são salvas e aplicadas na
            exportação.
          </p>
        </>
      )}
    </>
  );
}
