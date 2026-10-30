import assetCatalog from "../studio-assets.json";
import { backgrounds, type Appearance } from "../zoom";
import { RangeField as Range } from "./RangeField";

type BackgroundPanelProps = {
  appearance: (patch: Partial<Appearance>) => void;
  look: Appearance;
  wallpaperGroup: string;
  setWallpaperGroup: (group: string) => void;
  assetRoot: string;
  assetURL: (file: string) => string | undefined;
  palette: string[];
  setNotice: (message: string) => void;
  setError: (message: string) => void;
};

export function BackgroundPanel({
  appearance,
  look,
  wallpaperGroup,
  setWallpaperGroup,
  assetRoot,
  assetURL,
  palette,
  setNotice,
  setError,
}: BackgroundPanelProps) {
  return (
    <>
      <div className="panel-title">
        <h2>Background</h2>
        <span>Fundo e enquadramento</span>
      </div>
      <h3>Fundo</h3>
      <div className="segmented" role="group" aria-label="Tipo de fundo">
        <button
          className={look.backgroundMode === "wallpaper" ? "active" : ""}
          onClick={() =>
            appearance({
              backgroundMode: "wallpaper",
              wallpaper:
                look.wallpaper ||
                assetCatalog.wallpapers.find((item) => item.group === "macOS")!
                  .id,
            })
          }
        >
          Wallpaper
        </button>
        <button
          className={
            !look.backgroundMode || look.backgroundMode === "gradient"
              ? "active"
              : ""
          }
          onClick={() => appearance({ backgroundMode: "gradient" })}
        >
          Gradiente
        </button>
        <button
          className={look.backgroundMode === "color" ? "active" : ""}
          onClick={() => appearance({ backgroundMode: "color" })}
        >
          Cor
        </button>
      </div>
      <button
        className="wide subtle"
        aria-pressed={look.backgroundMode === "video-blur"}
        onClick={() =>
          appearance({
            backgroundMode: "video-blur",
            backgroundBlur: look.backgroundBlur || 18,
            cropFill: false,
            cropFollowCursor: false,
          })
        }
      >
        ▧ Fundo com vídeo desfocado
      </button>
      {look.backgroundMode === "video-blur" ? (
        <p className="help">
          Preserva a gravação inteira e amplia uma cópia desfocada atrás para
          preencher o formato vertical.
        </p>
      ) : look.backgroundMode === "wallpaper" ? (
        <>
          <select
            className="asset-group"
            aria-label="Coleção de wallpapers"
            value={wallpaperGroup}
            onChange={(e) => setWallpaperGroup(e.target.value)}
          >
            {[
              ...new Set(assetCatalog.wallpapers.map((item) => item.group)),
            ].map((group) => (
              <option key={group}>{group}</option>
            ))}
          </select>
          <button
            className="wide subtle random-background"
            disabled={!assetRoot}
            onClick={() => {
              const items = assetCatalog.wallpapers.filter(
                (item) =>
                  item.group === wallpaperGroup && item.id !== look.wallpaper,
              );
              appearance({
                wallpaper: items[Math.floor(Math.random() * items.length)].id,
              });
            }}
          >
            ✧ Escolher wallpaper aleatório
          </button>
          <div className="asset-grid wallpaper-grid">
            {assetRoot &&
              assetCatalog.wallpapers
                .filter((item) => item.group === wallpaperGroup)
                .map((item) => (
                  <button
                    key={item.id}
                    className={look.wallpaper === item.id ? "selected" : ""}
                    title={item.label}
                    aria-label={item.label}
                    aria-pressed={look.wallpaper === item.id}
                    onClick={() => appearance({ wallpaper: item.id })}
                  >
                    <img loading="lazy" src={assetURL(item.thumb)} alt="" />
                  </button>
                ))}
          </div>
        </>
      ) : (
        <>
          <button
            className="wide subtle random-background"
            onClick={() => {
              const next =
                (look.background +
                  1 +
                  Math.floor(Math.random() * (backgrounds.length - 1))) %
                backgrounds.length;
              appearance({ background: next, colors: undefined });
            }}
          >
            ✧ Escolher fundo aleatório
          </button>
          <div className="swatches">
            {backgrounds.map((colors, i) => (
              <button
                key={i}
                className={
                  !look.colors && look.background === i ? "selected" : ""
                }
                style={{
                  background: `linear-gradient(135deg,${colors[0]},${colors[1]})`,
                }}
                aria-label={`Gradiente ${i + 1}`}
                aria-pressed={look.background === i}
                onClick={() => appearance({ background: i, colors: undefined })}
              />
            ))}
          </div>
          <div className="color-fields">
            <label>
              <input
                aria-label="Cor principal do fundo"
                type="color"
                value={palette[0]}
                onChange={(e) =>
                  appearance({ colors: [e.target.value, palette[1]] })
                }
              />
              <span>{palette[0].toUpperCase()}</span>
            </label>
            {look.backgroundMode !== "color" && (
              <label>
                <input
                  aria-label="Segunda cor do gradiente"
                  type="color"
                  value={palette[1]}
                  onChange={(e) =>
                    appearance({
                      colors: [palette[0], e.target.value],
                    })
                  }
                />
                <span>{palette[1].toUpperCase()}</span>
              </label>
            )}
          </div>
        </>
      )}
      <Range
        label="Desfoque do fundo"
        min={0}
        max={30}
        value={look.backgroundBlur || 0}
        onChange={(backgroundBlur) => appearance({ backgroundBlur })}
      />
      <div className="section-line" />
      <h3>Enquadramento</h3>
      <Range
        label="Margem"
        min={0}
        max={20}
        value={look.padding}
        suffix="%"
        onChange={(padding) => appearance({ padding })}
      />
      <Range
        label="Cantos arredondados"
        min={0}
        max={40}
        value={look.radius}
        onChange={(radius) => appearance({ radius })}
      />
      <Range
        label="Sombra"
        min={0}
        max={100}
        value={look.shadow}
        suffix="%"
        onChange={(shadow) => appearance({ shadow })}
      />
      <button
        className="wide subtle"
        onClick={() => {
          try {
            localStorage.setItem("frame-preset", JSON.stringify(look));
            setNotice("Aparência salva como padrão para os próximos vídeos.");
          } catch {
            setError("Não foi possível salvar o preset local.");
          }
        }}
      >
        Salvar como padrão
      </button>
    </>
  );
}
