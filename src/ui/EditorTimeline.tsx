import type { PointerEvent, RefObject } from "react";
import { effectLabels } from "../annotations";
import type { Media, Panel, Project } from "../editor/types";
import { clamp, isAutoZoom, type Zoom } from "../zoom";
import { clipSpeed, formatTime, type Clip, type Effect } from "../timeline";
import type { Webcam } from "../webcam";
import { AppIcon } from "./AppIcon";

type TimelineClip = Clip & { index: number };

type EditorTimelineProps = {
  project: Project | null;
  projectRef: RefObject<Project | null>;
  media: Media | null;
  busy: boolean;
  duration: number;
  time: number;
  ranges: TimelineClip[];
  isWindows: boolean;
  selectedZoom: string | null;
  selectedClip: number | null;
  selectedEffect: string | null;
  selectedWebcam: Webcam | null | undefined;
  webcamKeyed: boolean;
  splitAtPlayhead: () => void;
  addEffect: (kind: Effect["kind"]) => void;
  deleteSelection: () => void;
  edit: (update: (project: Project) => Project) => void;
  setSelectedZoom: (id: string | null) => void;
  setSelectedClip: (index: number | null) => void;
  setSelectedEffect: (id: string | null) => void;
  setPanel: (panel: Panel) => void;
  seek: (time: number) => void;
  toggleWebcamKeyframe: () => void;
  addZoom: (time: number) => void;
  dragZoom: (event: PointerEvent<HTMLButtonElement>, zoom: Zoom) => void;
  dragEffectTiming: (event: PointerEvent<HTMLButtonElement>, effect: Effect) => void;
};

export function EditorTimeline({
  project,
  projectRef,
  media,
  busy,
  duration,
  time,
  ranges,
  isWindows: windowsDesktop,
  selectedZoom: selected,
  selectedClip,
  selectedEffect,
  selectedWebcam,
  webcamKeyed,
  splitAtPlayhead,
  addEffect,
  deleteSelection,
  edit,
  setSelectedZoom: setSelected,
  setSelectedClip,
  setSelectedEffect,
  setPanel,
  seek,
  toggleWebcamKeyframe,
  addZoom,
  dragZoom,
  dragEffectTiming,
}: EditorTimelineProps) {
  const clock = formatTime;
  return (
    <section className="timeline" aria-label="Timeline">
      <div className="timeline-heading">
        <span>
          <AppIcon name="settings" />
          Timeline{" "}
          <span className="timeline-duration">Edição {clock(duration)}</span>
        </span>
        <div className="timeline-actions">
          <button
            disabled={!project || busy}
            onClick={splitAtPlayhead}
            title={`Dividir no marcador ${windowsDesktop ? "Ctrl+B" : "⌘B"}`}
          >
            ✂ Dividir
          </button>
          <button
            disabled={!project || busy || !media}
            onClick={() => addEffect("mask")}
            title="Adicionar desfoque no marcador"
          >
            ▧ Desfocar
          </button>
          <button
            disabled={!project || busy || !media}
            onClick={() => addEffect("highlight")}
            title="Adicionar destaque no marcador"
          >
            ✦ Destacar
          </button>
          <button
            disabled={!project || busy || !media}
            onClick={() => addEffect("spotlight")}
            title="Adicionar spotlight no marcador"
          >
            ◉ Spotlight
          </button>
          <select
            aria-label="Adicionar anotação"
            value=""
            disabled={!project || busy || !media}
            onChange={(event) =>
              addEffect(event.target.value as Effect["kind"])
            }
          >
            <option value="" disabled>
              ＋ Anotação
            </option>
            {Object.entries(effectLabels)
              .filter(([kind]) => !["mask", "highlight"].includes(kind))
              .map(([kind, label]) => (
                <option key={kind} value={kind}>
                  {label}
                </option>
              ))}
          </select>
          <button
            disabled={
              busy ||
              (!selected &&
                selectedClip === null &&
                !selectedEffect &&
                !webcamKeyed)
            }
            onClick={deleteSelection}
            title="Apagar seleção · Delete"
          >
            ⌫ Apagar{" "}
            {selected
              ? "zoom"
              : selectedEffect
                ? "efeito"
                : webcamKeyed
                  ? "ajuste webcam"
                  : "trecho"}
          </button>
          <button
            disabled={!project?.zooms.length || busy}
            onClick={() => {
              edit((p) => ({ ...p, zooms: [] }));
              setSelected(null);
            }}
            title="Remover todos os efeitos de zoom"
          >
            Limpar zooms
          </button>
          {project?.clips && (
            <button
              disabled={busy}
              onClick={() => {
                edit((p) => ({ ...p, clips: undefined }));
                setSelectedClip(null);
              }}
            >
              Restaurar cortes
            </button>
          )}
        </div>
      </div>
      <div className="timeline-scroll">
        <div className="ruler">
          {Array.from({ length: 7 }, (_, i) => (
            <span key={i}>{clock(((media?.duration || 10) * i) / 6)}</span>
          ))}
        </div>
        <input
          className="seek-range"
          aria-label="Posição da reprodução"
          type="range"
          disabled={!media || busy}
          min={0}
          max={media?.duration || 10}
          step={0.001}
          value={time}
          onInput={(e) => seek(Number(e.currentTarget.value))}
        />
        <div className="tracks">
          <div
            className="playhead"
            style={{ left: `${(100 * time) / (media?.duration || 10)}%` }}
          />
          <div className="clip-lane" data-label="Vídeo">
            {project && media ? (
              ranges.map((clip) => (
                <button
                  key={clip.index}
                  className={`clip-track clip-segment ${selectedClip === clip.index ? "selected-clip" : ""}`}
                  disabled={busy}
                  style={{
                    left: `${(100 * clip.start) / media.duration}%`,
                    width: `${(100 * (clip.end - clip.start)) / media.duration}%`,
                  }}
                  aria-pressed={selectedClip === clip.index}
                  onClick={(e) => {
                    setSelectedClip(clip.index);
                    setSelected(null);
                    setSelectedEffect(null);
                    setPanel("clip");
                    const rect = e.currentTarget.getBoundingClientRect();
                    seek(
                      clip.start +
                        clamp((e.clientX - rect.left) / rect.width, 0, 1) *
                          (clip.end - clip.start),
                    );
                  }}
                  title={`${clock(clip.start)} → ${clock(clip.end)} · selecione para apagar`}
                >
                  <span>Trecho {clip.index + 1}</span>
                  <small>
                    {clock((clip.end - clip.start) / clipSpeed(clip))}
                    {clip.speed && clip.speed !== 1 ? ` · ${clip.speed}×` : ""}
                    {clip.hideCursor
                      ? " · cursor oculto"
                      : clip.cursorOriginal
                        ? " · cursor original"
                        : ""}
                  </small>
                </button>
              ))
            ) : (
              <div className="clip-track">Grave ou importe um vídeo</div>
            )}
          </div>
          {project?.microphone && (
            <div
              className="audio-track"
              data-label="Microfone"
              aria-label="Trilha do microfone"
            >
              <div className="audio-track-block">
                🎙 Microfone · {Math.round(project.microphone.volume * 100)}%
              </div>
            </div>
          )}
          <div
            className="audio-track"
            data-label="Música"
            aria-label="Música de fundo"
          >
            {project?.backgroundAudio && (
              <div
                className="audio-track-block"
                title={project.backgroundAudio.path.split("/").pop()}
              >
                ♫ {project.backgroundAudio.path.split("/").pop()} ·{" "}
                {Math.round(project.backgroundAudio.volume * 100)}%
              </div>
            )}
          </div>
          <div
            className="effect-track"
            data-label="Efeitos"
            aria-label="Anotações e efeitos"
          >
            {project?.effects?.map((effect) => (
              <button
                key={effect.id}
                className={`effect-block ${effect.kind} ${selectedEffect === effect.id ? "selected" : ""}`}
                disabled={busy}
                aria-pressed={selectedEffect === effect.id}
                style={{
                  left: `${(100 * effect.start) / (media?.duration || 1)}%`,
                  width: `${(100 * (effect.end - effect.start)) / (media?.duration || 1)}%`,
                }}
                onPointerDown={(event) => dragEffectTiming(event, effect)}
                onClick={() => {
                  const current = projectRef.current?.effects?.find(item => item.id === effect.id) ?? effect;
                  setSelectedEffect(effect.id);
                  setSelected(null);
                  setSelectedClip(null);
                  setPanel("effect");
                  seek(current.start);
                }}
                title={`${effectLabels[effect.kind]} · ${clock(effect.start)}–${clock(effect.end)} · arraste as bordas para ajustar a duração`}
              >
                <span className="effect-timing-handle start" data-timing-edge="start" title="Arraste para ajustar o início" aria-hidden="true" />
                <span className="effect-timing-label">{effect.kind === "mask" ? "▧" : "✦"}{" "}{clock(effect.end - effect.start)}</span>
                <span className="effect-timing-handle end" data-timing-edge="end" title="Arraste para ajustar o fim" aria-hidden="true" />
              </button>
            ))}
            {!project?.effects?.length && (
              <span className="track-placeholder">
                Adicione desfoques ou destaques no marcador
              </span>
            )}
          </div>
          <div
            className={`webcam-track ${project?.webcam ? "enabled" : "empty"}`}
            aria-label="Trilha independente da webcam"
          >
            <span className="webcam-track-title">Webcam</span>
            {selectedWebcam?.keyframes?.map((key, index) => (
              <button
                key={`${key.t}-${index}`}
                className={`webcam-keyframe ${Math.abs(key.t - time) < 0.02 ? "active" : ""}`}
                style={{ left: `${(100 * key.t) / (media?.duration || 1)}%` }}
                onClick={() => {
                  setSelected(null);
                  setSelectedEffect(null);
                  setSelectedClip(null);
                  setPanel("webcam");
                  seek(key.t);
                }}
                title={`Keyframe da webcam ${index + 1} · ${clock(key.t)}`}
                aria-label={`Selecionar movimento da webcam em ${clock(key.t)}`}
                aria-pressed={Math.abs(key.t - time) < 0.02}
              />
            ))}
            {project?.webcam ? (
              <button
                className={`webcam-track-add ${webcamKeyed ? "active" : ""}`}
                disabled={busy}
                onClick={() => {
                  setSelected(null);
                  setSelectedEffect(null);
                  setSelectedClip(null);
                  setPanel("webcam");
                  toggleWebcamKeyframe();
                }}
                title={
                  webcamKeyed
                    ? "Remover o ajuste da webcam no marcador"
                    : "Adicionar keyframe independente da webcam no marcador"
                }
                aria-label={
                  webcamKeyed
                    ? "Remover ajuste da webcam no marcador"
                    : "Adicionar ajuste da webcam no marcador"
                }
              >
                {webcamKeyed ? "−" : "+"}
              </button>
            ) : (
              <small className="webcam-track-hint">
                Ative a webcam para editar esta trilha
              </small>
            )}
            {project?.webcam && !selectedWebcam?.keyframes?.length && (
              <small className="webcam-track-hint">
                Posição fixa · adicione keyframes no marcador
              </small>
            )}
          </div>
          <div
            className="zoom-track"
            aria-label="Zoom da tela"
            onClick={(e) => {
              if (e.target !== e.currentTarget || !media) return;
              const rect = e.currentTarget.getBoundingClientRect();
              addZoom(((e.clientX - rect.left) / rect.width) * media.duration);
            }}
          >
            <span className="zoom-track-title">Zoom da tela</span>
            {project?.zooms.map((z) => (
              <button
                key={z.id}
                className={`zoom-block ${isAutoZoom(z) ? "automatic" : "manual"} ${selected === z.id ? "selected" : ""} ${!z.enabled ? "disabled-zoom" : ""}`}
                aria-pressed={selected === z.id}
                style={{
                  left: `${(100 * z.start) / (media?.duration || 1)}%`,
                  width: `${(100 * (z.end - z.start)) / (media?.duration || 1)}%`,
                }}
                disabled={busy}
                onPointerDown={(e) => dragZoom(e, z)}
                onClick={() => {
                  const current =
                    projectRef.current?.zooms.find(
                      (item) => item.id === z.id,
                    ) || z;
                  setSelected(z.id);
                  setSelectedClip(null);
                  setSelectedEffect(null);
                  setPanel("zoom");
                  seek(current.start + (current.end - current.start) / 2);
                }}
                title={`${isAutoZoom(z) ? "Zoom automático" : "Zoom manual"} · ${clock(z.start)} → ${clock(z.end)}`}
              >
                <span>⌕ {z.scale.toFixed(2)}×</span>
              </button>
            ))}
            {!project?.zooms.length && (
              <span className="track-placeholder">
                Clique nesta faixa para adicionar um zoom
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
