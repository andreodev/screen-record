import type { Dispatch, SetStateAction } from "react";
import { DeviceSelect } from "../DeviceSelect";
import type { Project } from "../editor/types";
import type { RecordingDevices, RecordingOptions } from "../recording-options";
import {
  webcamAt,
  type Webcam,
  type WebcamEasing,
  type WebcamKeyframe,
  type WebcamMode,
  type WebcamZoomBehavior,
} from "../webcam";
import { RangeField as Range } from "./RangeField";

type WebcamPanelProps = {
  desktop: boolean;
  recordingOptions: RecordingOptions;
  recordingDevices: RecordingDevices;
  busy: boolean;
  devicesLoading: boolean;
  setRecordingOptions: Dispatch<SetStateAction<RecordingOptions>>;
  refreshDevices: () => void | Promise<void>;
  devicesError: string | null;
  recordWebcam: boolean;
  cameraPreviewError: string | null;
  project: Project | null;
  currentWebcam: Webcam | null | undefined;
  webcamChange: (patch: Partial<Webcam> & Partial<WebcamKeyframe>) => void;
  selectedWebcam: Webcam | null | undefined;
  webcamKeyed: boolean;
  toggleWebcamKeyframe: () => void;
  time: number;
  retimeWebcamKeyframe: (time: number, keyTime?: number) => void;
  webcamKeyTimeDraft: number | null;
  setWebcamKeyTimeDraft: Dispatch<SetStateAction<number | null>>;
  seek: (time: number) => void;
  webcamClipboard: WebcamKeyframe | null;
  setWebcamClipboard: Dispatch<SetStateAction<WebcamKeyframe | null>>;
  edit: (update: (project: Project) => Project) => void;
  setRecordWebcam: Dispatch<SetStateAction<boolean>>;
};

export function WebcamPanel(props: WebcamPanelProps) {
  const {
    desktop,
    recordingOptions,
    recordingDevices,
    busy,
    devicesLoading,
    setRecordingOptions,
    refreshDevices,
    devicesError,
    recordWebcam,
    cameraPreviewError,
    project,
    currentWebcam,
    webcamChange,
    selectedWebcam,
    webcamKeyed,
    toggleWebcamKeyframe,
    time,
    retimeWebcamKeyframe,
    webcamKeyTimeDraft,
    setWebcamKeyTimeDraft,
    seek,
    webcamClipboard,
    setWebcamClipboard,
    edit,
    setRecordWebcam,
  } = props;
  return (
    <>
      <div className="panel-title">
        <h2>Webcam</h2>
        <span>Sobreposição na gravação</span>
      </div>
      {desktop && (
        <>
          <DeviceSelect
            label="Webcam para gravar"
            value={recordingOptions.cameraDevice}
            devices={recordingDevices.cameras}
            disabled={busy || devicesLoading}
            onChange={(cameraDevice) =>
              setRecordingOptions((options) => ({
                ...options,
                cameraDevice,
              }))
            }
          />
          <button
            className="wide subtle"
            disabled={busy || devicesLoading}
            onClick={() => void refreshDevices()}
          >
            {devicesLoading
              ? "Buscando dispositivos…"
              : "Atualizar dispositivos"}
          </button>
          {devicesError && (
            <p className="help capture-device-error" role="alert">
              {devicesError}
            </p>
          )}
          {recordWebcam && (
            <p className="help">
              A prévia está em uma janela flutuante, excluída da captura da
              tela. Arrastá-la não altera a posição da webcam no vídeo.
            </p>
          )}
          {cameraPreviewError && (
            <p className="help" role="alert">
              {cameraPreviewError}
            </p>
          )}
        </>
      )}
      {project?.webcam ? (
        <>
          <p className="help">
            Arraste a webcam pelo quadro. Os ajustes são independentes para 16:9
            e 9:16 e não recebem o zoom da tela.
          </p>
          <label className="select-field">
            Animação
            <select
              value={currentWebcam?.mode ?? "static"}
              onChange={(e) =>
                webcamChange({ mode: e.target.value as WebcamMode })
              }
            >
              <option value="static">Estática</option>
              <option value="manual">Manual por keyframes</option>
              <option value="auto">Automática</option>
              <option value="hybrid">Híbrida</option>
            </select>
          </label>
          <label className="select-field">
            Tamanho durante zoom
            <select
              value={selectedWebcam?.zoomBehavior ?? "keep"}
              onChange={(e) =>
                webcamChange({
                  zoomBehavior: e.target.value as WebcamZoomBehavior,
                })
              }
            >
              <option value="keep">Manter</option>
              <option value="shrink">Diminuir</option>
              <option value="grow">Aumentar</option>
              <option value="custom">Personalizado</option>
            </select>
          </label>
          {selectedWebcam?.zoomBehavior === "custom" && (
            <Range
              label="Tamanho em foco"
              min={8}
              max={60}
              suffix="%"
              value={(selectedWebcam.zoomSize ?? selectedWebcam.size) * 100}
              onChange={(v) => webcamChange({ zoomSize: v / 100 })}
            />
          )}
          <Range
            label="Transição do tamanho automático"
            min={150}
            max={2000}
            suffix=" ms"
            value={(selectedWebcam?.transitionDuration ?? 0.4) * 1000}
            onChange={(v) => webcamChange({ transitionDuration: v / 1000 })}
          />
          <p className="help">
            Acompanha a aproximação real da tela e mantém o tamanho durante o
            foco. Keyframes manuais têm prioridade sobre o tamanho automático.
          </p>
          <p className="help">
            Automática e híbrida afastam a webcam do foco central quando há
            risco de cobrir a área ampliada. Não inferem fala nem reagem a cada
            clique.
          </p>
          <button
            className={`wide subtle ${webcamKeyed ? "camera-key-active" : ""}`}
            onClick={toggleWebcamKeyframe}
          >
            {webcamKeyed
              ? "◆ Ajuste neste momento · remover"
              : "◇ Adicionar ajuste neste momento"}
          </button>
          <div
            className="segmented"
            role="group"
            aria-label="Formato da webcam"
          >
            {(
              [
                ["circle", "Redondo"],
                ["rounded", "Cantos"],
                ["square", "Quadrado"],
                ["rectangle", "Original"],
              ] as const
            ).map(([shape, label]) => (
              <button
                key={shape}
                className={currentWebcam?.shape === shape ? "active" : ""}
                aria-pressed={currentWebcam?.shape === shape}
                onClick={() =>
                  webcamChange({
                    shape,
                    borderRadius:
                      shape === "circle" ? 0.5 : shape === "square" ? 0 : 0.18,
                  })
                }
              >
                {label}
              </button>
            ))}
          </div>
          <Range
            label="Tamanho"
            min={8}
            max={60}
            suffix="%"
            value={
              (selectedWebcam ? webcamAt(selectedWebcam, time) : project.webcam)
                .size * 100
            }
            onChange={(size) => {
              const camera = currentWebcam;
              const normalizedSize = size / 100;
              if (camera) webcamChange({ size: normalizedSize });
            }}
          />
          <button
            className="wide subtle"
            onClick={() => webcamChange({ size: 0.24, x: 0.78, y: 0.78 })}
          >
            Restaurar tamanho e posição
          </button>
          {currentWebcam?.shape !== "circle" && (
            <Range
              label="Arredondamento"
              min={0}
              max={50}
              suffix="%"
              value={
                (currentWebcam?.borderRadius ??
                  (currentWebcam?.shape === "square" ? 0 : 0.18)) * 100
              }
              onChange={(v) => webcamChange({ borderRadius: v / 100 })}
            />
          )}
          <label className="switch-label">
            Exibir webcam
            <input
              type="checkbox"
              checked={(currentWebcam?.opacity ?? 1) > 0}
              onChange={(e) =>
                webcamChange({ opacity: e.target.checked ? 1 : 0 })
              }
            />
          </label>
          <Range
            label="Opacidade"
            min={0}
            max={100}
            suffix="%"
            value={Math.round((currentWebcam?.opacity ?? 1) * 100)}
            onChange={(v) => webcamChange({ opacity: v / 100 })}
          />
          <Range
            label="Borda"
            min={0}
            max={8}
            suffix=" px"
            value={currentWebcam?.border ?? 2}
            onChange={(v) => webcamChange({ border: v })}
          />
          <Range
            label="Sombra"
            min={0}
            max={100}
            suffix="%"
            value={currentWebcam?.shadow ?? 35}
            onChange={(v) => webcamChange({ shadow: v })}
          />
          <h3>Posição</h3>
          <div className="segmented camera-corners">
            {(
              [
                [0, 0, "↖", "Superior esquerdo"],
                [0.5, 0, "↑", "Superior central"],
                [1, 0, "↗", "Superior direito"],
                [0, 1, "↙", "Inferior esquerdo"],
                [0.5, 1, "↓", "Inferior central"],
                [1, 1, "↘", "Inferior direito"],
              ] as const
            ).map(([x, y, label, title]) => (
              <button
                key={title}
                title={title}
                aria-label={title}
                onClick={() => webcamChange({ x, y })}
              >
                {label}
              </button>
            ))}
          </div>
          {webcamKeyed && currentWebcam?.mode !== "static" && (
            <>
              <label className="select-field">
                Curva da transição
                <select
                  value={
                    selectedWebcam?.keyframes?.find(
                      (key) => Math.abs(key.t - time) < 0.02,
                    )?.easing ?? "ease-in-out"
                  }
                  onChange={(e) =>
                    webcamChange({
                      easing: e.target.value as WebcamEasing,
                    })
                  }
                >
                  <option value="ease-in-out">Suave · ease in-out</option>
                  <option value="ease-out">Desacelerar · ease out</option>
                  <option value="linear">Linear</option>
                  <option value="cubic-bezier">Cubic Bézier · suave</option>
                </select>
              </label>
              {(() => {
                const next = selectedWebcam?.keyframes?.find(
                  (key) => key.t > time + 0.02,
                );
                return next ? (
                  <label className="time-inputs webcam-key-time">
                    Duração até o próximo estado (s)
                    <input
                      key={`${time}-${next.t}`}
                      type="number"
                      min="0.05"
                      max={project.trim.end - time}
                      step="0.05"
                      defaultValue={Number((next.t - time).toFixed(3))}
                      onBlur={(e) => {
                        const duration = Number(e.target.value);
                        if (Number.isFinite(duration) && duration >= 0.05)
                          retimeWebcamKeyframe(time + duration, next.t);
                      }}
                    />
                  </label>
                ) : null;
              })()}
              <label className="time-inputs webcam-key-time">
                Tempo do keyframe
                <input
                  type="number"
                  min={project.trim.start}
                  max={project.trim.end}
                  step="0.05"
                  value={
                    webcamKeyTimeDraft ??
                    selectedWebcam?.keyframes?.find(
                      (key) => Math.abs(key.t - time) < 0.02,
                    )?.t ??
                    time
                  }
                  onFocus={() =>
                    setWebcamKeyTimeDraft(
                      selectedWebcam?.keyframes?.find(
                        (key) => Math.abs(key.t - time) < 0.02,
                      )?.t ?? time,
                    )
                  }
                  onChange={(e) =>
                    setWebcamKeyTimeDraft(Number(e.target.value))
                  }
                  onBlur={() => {
                    if (webcamKeyTimeDraft !== null) {
                      retimeWebcamKeyframe(webcamKeyTimeDraft);
                      seek(webcamKeyTimeDraft);
                      setWebcamKeyTimeDraft(null);
                    }
                  }}
                />
              </label>
            </>
          )}
          <div className="motion-options">
            <button
              onClick={() => {
                if (currentWebcam)
                  setWebcamClipboard({
                    t: time,
                    x: currentWebcam.x,
                    y: currentWebcam.y,
                    size: currentWebcam.size,
                    opacity: currentWebcam.opacity,
                    borderRadius: currentWebcam.borderRadius,
                    easing:
                      selectedWebcam?.keyframes?.find(
                        (key) => Math.abs(key.t - time) < 0.02,
                      )?.easing ??
                      currentWebcam.easing ??
                      "ease-in-out",
                  });
              }}
            >
              Copiar estado
            </button>
            <button
              disabled={!webcamClipboard}
              onClick={() => webcamClipboard && webcamChange(webcamClipboard)}
            >
              Colar estado
            </button>
          </div>
          <button
            className="wide danger"
            onClick={() =>
              edit((p) => ({ ...p, version: 11, webcam: undefined }))
            }
          >
            Remover webcam do vídeo
          </button>
          <p className="help">
            Os marcadores da webcam ficam visíveis na timeline. Entre dois
            marcadores, posição e tamanho mudam suavemente; a exportação
            acompanha essa animação.
          </p>
        </>
      ) : (
        <>
          <label className="switch-label">
            Gravar com webcam
            <input
              type="checkbox"
              checked={recordWebcam}
              disabled={!desktop || busy}
              onChange={(e) => setRecordWebcam(e.target.checked)}
            />
          </label>
          <p className="help">
            A câmera selecionada será gravada em uma faixa separada para você
            ajustar o formato e a posição depois.
          </p>
        </>
      )}
    </>
  );
}
