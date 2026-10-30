import type { Media } from "../editor/types";
import { cursorThemes, themeCursor } from "../cursor";
import type { Appearance, CursorEvent } from "../zoom";
import { RangeField as Range } from "./RangeField";

type CursorPanelProps = {
  canEditCursor: boolean;
  openProject: () => void | Promise<void>;
  busy: boolean;
  look: Appearance;
  appearance: (patch: Partial<Appearance>) => void;
  assetURL: (file: string) => string | undefined;
  events: CursorEvent[];
  cursorSmooth: boolean;
  media: Media | null;
};

export function CursorPanel({
  canEditCursor,
  openProject,
  busy,
  look,
  appearance,
  assetURL,
  events,
  cursorSmooth,
  media,
}: CursorPanelProps) {
  return (
    <>
      <div className="panel-title">
        <h2>Cursor</h2>
        <span>Movimento e visibilidade</span>
      </div>
      {!canEditCursor && (
        <div className="cursor-unavailable" role="status">
          <strong>Este vídeo não tem cursor editável</strong>
          <p>
            O ponteiro de um MP4 exportado já faz parte da imagem. Abra o
            projeto .framestudio original ou faça uma nova gravação para trocar
            o cursor.
          </p>
          <button className="wide subtle" onClick={() => void openProject()}>
            Abrir projeto original
          </button>
        </div>
      )}
      <fieldset disabled={!canEditCursor || busy}>
        <h3>Conjunto de cursores</h3>
        <div className="cursor-themes">
          {cursorThemes.map((theme) => (
            <button
              key={theme}
              className={look.cursorTheme === theme ? "selected" : ""}
              aria-pressed={look.cursorTheme === theme}
              onClick={() =>
                appearance({
                  cursorTheme: theme,
                  cursorAsset: undefined,
                })
              }
            >
              <span className="theme-samples">
                {["pointer", "pointinghand", "ibeam"].map((kind) => (
                  <img
                    key={kind}
                    src={assetURL(themeCursor(theme, kind).file)}
                    alt=""
                  />
                ))}
              </span>
              <span>
                {theme === "macos"
                  ? "macOS padrão"
                  : theme === "macos-tahoe"
                    ? "macOS Tahoe"
                    : theme}
              </span>
            </button>
          ))}
        </div>
        {!events.some((event) => event.kind) && (
          <p className="help">
            Esta gravação antiga não contém os tipos de cursor. O conjunto usa a
            seta; as trocas de contexto precisam ser registradas durante uma
            nova gravação.
          </p>
        )}
        <label className="switch-label">
          Ocultar cursor parado
          <input
            type="checkbox"
            checked={look.hideIdleCursor ?? false}
            onChange={(event) =>
              appearance({ hideIdleCursor: event.target.checked })
            }
          />
        </label>
        <label className="capture-device-select">
          <span>Efeito de clique</span>
          <select
            aria-label="Efeito de clique"
            value={look.clickEffect ?? "none"}
            onChange={(event) =>
              appearance({
                clickEffect: event.target.value as Appearance["clickEffect"],
              })
            }
          >
            <option value="none">Nenhum</option>
            <option value="circle">Círculo</option>
            <option value="ripple">Onda</option>
          </select>
        </label>
        <Range
          label="Tamanho"
          min={0}
          max={64}
          value={look.cursorSize}
          onChange={(cursorSize) => appearance({ cursorSize })}
        />
        <label className="switch-label">
          Movimento suave
          <input
            type="checkbox"
            checked={cursorSmooth}
            onChange={(e) =>
              appearance({
                cursorSmooth: e.target.checked,
                cursorMotion: e.target.checked ? "medium" : "original",
              })
            }
          />
        </label>
        <p className="help">
          {media?.cursorCaptured
            ? "Cursor reconstruído separadamente da gravação. Defina o tamanho como zero para ocultar."
            : "Este vídeo não tem trilha de cursor. O ponteiro já presente no vídeo não pode ser separado."}
        </p>
      </fieldset>
    </>
  );
}
