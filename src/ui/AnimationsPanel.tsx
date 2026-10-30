import {
  cameraMotionFor,
  cursorResponseFor,
  motionPresets,
} from "../cinematic";
import { cursorMotionFor } from "../zoom";
import { formatTime } from "../timeline";
import type { Appearance } from "../zoom";
import type { Media } from "../editor/types";
import { RangeField as Range } from "./RangeField";

type AnimationsPanelProps = {
  look: Appearance;
  appearance: (patch: Partial<Appearance>) => void;
  time: number;
  canEditCursor: boolean;
  seek: (time: number) => void;
  media: Media | null;
};

export function AnimationsPanel({
  look,
  appearance,
  time,
  canEditCursor,
  seek,
  media,
}: AnimationsPanelProps) {
  const cameraMotion = cameraMotionFor(look);
  const cursorResponse = cursorResponseFor(look);
  const cursorMotion = cursorMotionFor(look);
  const clock = formatTime;
  return (
    <section className="animations-panel" aria-label="Animações">
      <div className="panel-title">
        <h2>Animações</h2>
        <span>Movimentos com intenção</span>
      </div>
      <h3 id="screen-animation-label">Animação da tela</h3>
      <div
        className="motion-options"
        role="group"
        aria-labelledby="screen-animation-label"
      >
        <button
          className={!look.smooth ? "active" : ""}
          aria-pressed={!look.smooth}
          onClick={() => appearance({ smooth: false })}
        >
          Focado
        </button>
        <button
          className={look.smooth ? "active" : ""}
          aria-pressed={look.smooth}
          onClick={() => appearance({ smooth: true })}
        >
          Suave
        </button>
      </div>
      <p className="help">
        {look.smooth
          ? "Transições mais longas e acompanhamento gradual para apresentações."
          : "A câmera estabiliza mais rápido para facilitar a leitura."}
      </p>
      <div className="section-line" />
      <h3>Camera Motion</h3>
      <div className="segmented" role="group" aria-label="Motion Style">
        {(["smooth", "cinematic", "dynamic"] as const).map((style) => (
          <button
            key={style}
            className={cameraMotion.style === style ? "active" : ""}
            aria-pressed={cameraMotion.style === style}
            onClick={() =>
              appearance({
                cameraMotion: {
                  ...motionPresets[style],
                  impacts: cameraMotion.impacts,
                },
                motionBlur: {
                  cursor: look.motionBlur?.cursor ?? 0,
                  zoom: 1,
                  pan: 1,
                },
              })
            }
          >
            {style === "smooth"
              ? "Smooth"
              : style === "cinematic"
                ? "Cinematic"
                : "Dynamic"}
          </button>
        ))}
      </div>
      <label className="switch-label">
        Micro-Shake
        <input
          type="checkbox"
          checked={cameraMotion.shake}
          onChange={(e) =>
            appearance({
              cameraMotion: {
                ...cameraMotion,
                shake: e.target.checked,
              },
            })
          }
        />
      </label>
      <fieldset disabled={!cameraMotion.shake}>
        <Range
          label="Intensidade do micro-shake"
          min={0.1}
          max={0.4}
          step={0.01}
          suffix="%"
          value={cameraMotion.intensity * 100}
          onChange={(v) =>
            appearance({
              cameraMotion: { ...cameraMotion, intensity: v / 100 },
            })
          }
        />
        <Range
          label="Duração do micro-shake"
          min={80}
          max={180}
          suffix=" ms"
          value={cameraMotion.duration * 1000}
          onChange={(v) =>
            appearance({
              cameraMotion: { ...cameraMotion, duration: v / 1000 },
            })
          }
        />
        <button
          className="wide subtle"
          onClick={() => {
            const impacts = cameraMotion.impacts ?? [];
            appearance({
              cameraMotion: {
                ...cameraMotion,
                impacts: impacts.some((t) => Math.abs(t - time) < 0.05)
                  ? impacts.filter((t) => Math.abs(t - time) >= 0.05)
                  : [...impacts, time].sort((a, b) => a - b),
              },
            });
          }}
        >
          {cameraMotion.impacts?.some((t) => Math.abs(t - time) < 0.05)
            ? "Remover impacto no marcador"
            : "Adicionar impacto no marcador"}
        </button>
      </fieldset>
      {!!cameraMotion.impacts?.length && (
        <div className="motion-options" aria-label="Impactos manuais">
          {cameraMotion.impacts.map((t) => (
            <button
              key={t}
              title="Selecionar impacto; use Remover no marcador para apagá-lo"
              onClick={() => seek(t)}
            >
              ✦ {clock(t)}
            </button>
          ))}
        </div>
      )}
      <label className="switch-label">
        Micro-shake separado na webcam
        <input
          type="checkbox"
          checked={cameraMotion.webcamShake ?? false}
          onChange={(e) =>
            appearance({
              cameraMotion: {
                ...cameraMotion,
                webcamShake: e.target.checked,
              },
            })
          }
        />
      </label>
      <p className="help">
        Cinematic acompanha o cursor com inércia e motion blur nos deslocamentos
        e zooms. A imagem volta a ficar nítida ao parar. Micro-Shake adiciona
        tremor e vem desligado.
      </p>
      <label className="switch-label">
        Motion Blur
        <input
          type="checkbox"
          checked={cameraMotion.blur}
          onChange={(e) =>
            appearance({
              cameraMotion: {
                ...cameraMotion,
                blur: e.target.checked,
              },
            })
          }
        />
      </label>
      <fieldset disabled={!cameraMotion.blur}>
        <Range
          label="Intensidade do blur da câmera"
          min={0}
          max={100}
          suffix="%"
          value={cameraMotion.blurIntensity * 100}
          onChange={(v) =>
            appearance({
              cameraMotion: {
                ...cameraMotion,
                blurIntensity: v / 100,
              },
            })
          }
        />
      </fieldset>
      <label className="switch-label">
        Spring
        <input
          type="checkbox"
          checked={cameraMotion.spring}
          onChange={(e) =>
            appearance({
              cameraMotion: {
                ...cameraMotion,
                spring: e.target.checked,
              },
            })
          }
        />
      </label>
      <fieldset disabled={!cameraMotion.spring}>
        <Range
          label="Amortecimento"
          min={80}
          max={150}
          suffix="%"
          value={cameraMotion.damping * 100}
          onChange={(v) =>
            appearance({
              cameraMotion: { ...cameraMotion, damping: v / 100 },
            })
          }
        />
      </fieldset>
      <button
        className="wide subtle"
        onClick={() =>
          appearance({
            cameraMotion: {
              ...motionPresets.smooth,
              impacts: cameraMotion.impacts,
              spring: false,
              shake: false,
              blur: false,
            },
          })
        }
      >
        Desativar Camera Motion
      </button>
      <h3 id="cursor-animation-label">Animação do cursor</h3>
      <fieldset disabled={!canEditCursor}>
        <label className="capture-device-select">
          <span>Resposta ao movimento</span>
          <select
            aria-label="Resposta ao movimento"
            value={cursorResponse.style}
            onChange={(event) =>
              appearance({
                cursorResponse: {
                  ...cursorResponse,
                  style: event.target.value as typeof cursorResponse.style,
                },
              })
            }
          >
            <option value="off">Desligada</option>
            <option value="smooth">Suave</option>
            <option value="cinematic">Cinematic</option>
            <option value="dynamic">Dynamic</option>
          </select>
        </label>
        <fieldset disabled={cursorResponse.style === "off"}>
          <Range
            label="Intensidade do shake do cursor"
            min={0}
            max={100}
            suffix="%"
            value={cursorResponse.intensity * 100}
            onChange={(value) =>
              appearance({
                cursorResponse: {
                  ...cursorResponse,
                  intensity: value / 100,
                },
              })
            }
          />
          <label className="switch-label">
            Impacto ao mudar de direção
            <input
              type="checkbox"
              checked={cursorResponse.directionImpact}
              onChange={(event) =>
                appearance({
                  cursorResponse: {
                    ...cursorResponse,
                    directionImpact: event.target.checked,
                  },
                })
              }
            />
          </label>
        </fieldset>
        <label className="capture-device-select">
          <span>Acompanhar cursor</span>
          <select
            aria-label="Acompanhar cursor"
            value={look.cursorFollow ?? "balanced"}
            onChange={(event) =>
              appearance({
                cursorFollow: event.target.value as Appearance["cursorFollow"],
              })
            }
          >
            <option value="off">Desligado</option>
            <option value="balanced">Equilibrado</option>
            <option value="close">Próximo</option>
          </select>
        </label>
        <fieldset disabled={look.cursorFollow === "off"}>
          <Range
            label="Antecipação do zoom"
            min={0}
            max={35}
            suffix="%"
            value={(look.zoomAnticipation ?? 0.35) * 100}
            onChange={(value) => appearance({ zoomAnticipation: value / 100 })}
          />
        </fieldset>
        <p className="help">
          Cliques preservados sempre. O shake acompanha a direção e a velocidade
          e desaparece ao parar. O modo Original do trecho usa a posição
          gravada.
        </p>
        <div
          className="motion-options cursor-motion-options"
          role="group"
          aria-labelledby="cursor-animation-label"
          aria-describedby="cursor-animation-help"
        >
          {(
            [
              ["original", "Original"],
              ["smooth", "Suave"],
              ["medium", "Médio"],
              ["rapid", "Rápido"],
            ] as const
          ).map(([motion, label]) => (
            <button
              key={motion}
              className={cursorMotion === motion ? "active" : ""}
              aria-pressed={cursorMotion === motion}
              onClick={() =>
                appearance({
                  cursorMotion: motion,
                  cursorSmooth: motion !== "original",
                })
              }
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <p className="help" id="cursor-animation-help">
        {media && !canEditCursor
          ? "Este vídeo não tem trilha de cursor. Abra o projeto original ou faça uma nova gravação para animar o ponteiro."
          : "A suavização preserva a posição dos cliques e funciona independentemente da animação da tela."}
      </p>
      <div className="section-line" />
      <h3>Motion blur</h3>
      <Range
        label="Movimento do cursor"
        min={0}
        max={1}
        step={0.05}
        value={look.motionBlur?.cursor ?? 0}
        onChange={(cursor) =>
          appearance({
            motionBlur: {
              ...(look.motionBlur ?? { cursor: 0, zoom: 1, pan: 1 }),
              cursor,
            },
          })
        }
      />
      <Range
        label="Aproximação e afastamento"
        min={0}
        max={1}
        step={0.05}
        value={look.motionBlur?.zoom ?? 1}
        onChange={(zoom) =>
          appearance({
            motionBlur: {
              ...(look.motionBlur ?? { cursor: 0, zoom: 1, pan: 1 }),
              zoom,
            },
          })
        }
      />
      <Range
        label="Deslocamento da tela"
        min={0}
        max={1}
        step={0.05}
        value={look.motionBlur?.pan ?? 1}
        onChange={(pan) =>
          appearance({
            motionBlur: {
              ...(look.motionBlur ?? { cursor: 0, zoom: 1, pan: 1 }),
              pan,
            },
          })
        }
      />
      <p className="help">
        A intensidade zero desativa cada efeito. O desfoque acompanha o
        movimento e aparece também na exportação.
      </p>
    </section>
  );
}
