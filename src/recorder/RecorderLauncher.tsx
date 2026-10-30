import type { Dispatch, SetStateAction } from "react";
import { m } from "motion/react";
import type { CaptureSelection } from "../capture-options";
import type { Operation } from "../editor/types";
import type { RecordingDevices, RecordingOptions } from "../recording-options";
import { AppIcon } from "../ui/AppIcon";
import { RecorderDevice } from "./RecorderDevice";
import { useCaptureSources } from "./useCaptureSources";

export type RecorderLauncherProps = {
  desktop: boolean;
  operation: Operation;
  error: string;
  permissionDenied: boolean;
  hasProject: boolean;
  returnToEditor: () => void;
  record: (selection: CaptureSelection) => Promise<void>;
  importVideo: () => Promise<void>;
  openProject: () => Promise<void>;
  recordWebcam: boolean;
  setRecordWebcam: Dispatch<SetStateAction<boolean>>;
  recordMicrophone: boolean;
  setRecordMicrophone: Dispatch<SetStateAction<boolean>>;
  recordSystemAudio: boolean;
  setRecordSystemAudio: Dispatch<SetStateAction<boolean>>;
  recordingOptions: RecordingOptions;
  setRecordingOptions: Dispatch<SetStateAction<RecordingOptions>>;
  recordingDevices: RecordingDevices;
  devicesLoading: boolean;
  devicesError: string;
  refreshDevices: () => Promise<void>;
  openPermissions: () => void;
  windowAction: (action: "drag" | "minimize" | "close") => void;
};

const modes = [
  { kind: "display", title: "Tela inteira", icon: "record" },
  { kind: "area", title: "Área", icon: "zoom" },
  { kind: "window", title: "Janela", icon: "folder" },
] as const;

export function RecorderLauncher(props: RecorderLauncherProps) {
  const {
    desktop,
    operation,
    error,
    hasProject,
    returnToEditor,
    record,
    importVideo,
    openProject,
    recordWebcam,
    setRecordWebcam,
    recordMicrophone,
    setRecordMicrophone,
    recordSystemAudio,
    setRecordSystemAudio,
    recordingOptions,
    setRecordingOptions,
    recordingDevices,
    devicesLoading,
    devicesError,
    refreshDevices,
    openPermissions,
    windowAction,
  } = props;
  const busy = operation !== "idle";
  const sources = useCaptureSources(desktop, !busy);
  const updateDevice = (
    field: "cameraDevice" | "microphoneDevice" | "outputDevice",
    value: string | null,
  ) => setRecordingOptions((options) => ({ ...options, [field]: value }));

  // The native window is hidden throughout capture, pause and finalization.
  // All recording controls live in the OS tray/menu bar.
  if (
    ["starting", "recording", "pausing", "paused", "stopping"].includes(
      operation,
    )
  )
    return null;

  return (
    <main className="recorder-launcher" aria-label="Preparar gravação">
      <header
        className="recorder-header"
        onPointerDown={(event) => {
          if (event.button === 0) windowAction("drag");
        }}
      >
        <div className="recorder-brand">
          <span className="brand-mark" aria-hidden="true" />
          <strong>
            Frame <span>Studio</span>
          </strong>
        </div>
        <div
          className="recorder-window-actions"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            aria-label="Minimizar"
            onClick={() => windowAction("minimize")}
          >
            −
          </button>
          <button aria-label="Fechar" onClick={() => windowAction("close")}>
            ×
          </button>
        </div>
      </header>
      <div className="recorder-content">
        <section aria-labelledby="capture-mode-heading">
          <div className="recorder-section-heading">
            <h1 id="capture-mode-heading">Nova gravação</h1>
            <button
              disabled={busy || sources.loading}
              onClick={() => void sources.refresh()}
              aria-label="Atualizar fontes de captura"
            >
              ↻
            </button>
          </div>
          <div
            className="recorder-modes"
            role="group"
            aria-label="Modo de captura"
          >
            {modes.map((mode) => (
              <button
                className={`recorder-mode ${sources.kind === mode.kind ? "selected" : ""}`}
                key={mode.kind}
                disabled={busy}
                aria-pressed={sources.kind === mode.kind}
                onClick={() => sources.changeKind(mode.kind)}
              >
                <AppIcon name={mode.icon} />
                <span>{mode.title}</span>
                {sources.kind === mode.kind && (
                  <m.span
                    layoutId="capture-mode-active"
                    className="capture-mode-active"
                    transition={{ duration: 0.16 }}
                  />
                )}
              </button>
            ))}
          </div>
          <label className="recorder-source">
            <span>{sources.kind === "window" ? "Janela" : "Monitor"}</span>
            <select
              aria-label="Fonte de captura"
              disabled={busy || sources.loading || !sources.choices.length}
              value={sources.selected?.id ?? ""}
              onChange={(event) =>
                sources.setSourceId(Number(event.target.value))
              }
            >
              {!sources.selected && !!sources.choices.length && (
                <option value="" disabled>
                  Escolha outra fonte
                </option>
              )}
              {!sources.choices.length && (
                <option value="">
                  {sources.loading
                    ? "Buscando fontes…"
                    : "Nenhuma fonte disponível"}
                </option>
              )}
              {sources.choices.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.label}
                </option>
              ))}
            </select>
          </label>
          {sources.kind === "area" && (
            <fieldset className="recorder-area" disabled={busy}>
              <legend>Área em pixels</legend>
              {(["x", "y", "width", "height"] as const).map((field, index) => (
                <label key={field}>
                  {["X", "Y", "Largura", "Altura"][index]}
                  <input
                    aria-label={`Área: ${field}`}
                    type="number"
                    min={index < 2 ? 0 : 32}
                    value={sources.area[field]}
                    onChange={(event) =>
                      sources.setArea({
                        ...sources.area,
                        [field]: Number(event.target.value),
                      })
                    }
                  />
                </label>
              ))}
              {!sources.selection && (
                <small role="status">
                  Escolha uma área válida dentro do monitor.
                </small>
              )}
            </fieldset>
          )}
        </section>
        <section
          className="recorder-devices"
          aria-label="Dispositivos de gravação"
        >
          <RecorderDevice
            label="Webcam"
            icon="webcam"
            enabled={recordWebcam}
            toggle={() => setRecordWebcam((value) => !value)}
            value={recordingOptions.cameraDevice}
            onChange={(value) => updateDevice("cameraDevice", value)}
            devices={recordingDevices.cameras}
            disabled={!desktop || busy || devicesLoading}
          />
          <RecorderDevice
            label="Microfone"
            icon="audio"
            enabled={recordMicrophone}
            toggle={() => setRecordMicrophone((value) => !value)}
            value={recordingOptions.microphoneDevice}
            onChange={(value) => updateDevice("microphoneDevice", value)}
            devices={recordingDevices.inputs}
            disabled={!desktop || busy || devicesLoading}
          />
          <RecorderDevice
            label="Áudio do sistema"
            icon="audio"
            enabled={recordSystemAudio}
            toggle={() => setRecordSystemAudio((value) => !value)}
            value={recordingOptions.outputDevice}
            onChange={(value) => updateDevice("outputDevice", value)}
            devices={recordingDevices.outputs}
            disabled={!desktop || busy || devicesLoading}
          />
        </section>
        <details className="recorder-options">
          <summary>
            {sources.resolution === 2160 ? "4K" : "1080p"} · {sources.fps} fps{" "}
            <span>Ajustes</span>
          </summary>
          <div>
            <select
              aria-label="Resolução da captura"
              value={sources.resolution}
              disabled={busy}
              onChange={(event) =>
                sources.setResolution(Number(event.target.value))
              }
            >
              <option value={1080}>1080p</option>
              <option value={2160}>4K</option>
            </select>
            <select
              aria-label="FPS da captura"
              value={sources.fps}
              disabled={busy}
              onChange={(event) => sources.setFps(Number(event.target.value))}
            >
              <option value={30}>30 fps</option>
              <option value={60}>60 fps</option>
            </select>
            <button
              disabled={busy || devicesLoading}
              onClick={() => void refreshDevices()}
            >
              Atualizar dispositivos
            </button>
          </div>
        </details>
      </div>
      <footer className="recorder-footer">
        <div className="recorder-file-actions">
          <button
            disabled={!desktop || busy}
            onClick={() => void importVideo()}
          >
            Importar vídeo
          </button>
          <button
            disabled={!desktop || busy}
            onClick={() => void openProject()}
          >
            Abrir projeto
          </button>
          {hasProject && (
            <button disabled={busy} onClick={returnToEditor}>
              Voltar
            </button>
          )}
        </div>
        <button
          className="recorder-start"
          disabled={!desktop || busy || sources.loading || !sources.selection}
          onClick={() => {
            if (sources.selection) void record(sources.selection);
          }}
        >
          <span className="red-dot" />
          {operation === "opening" ? "Abrindo…" : "Gravar"}
        </button>
      </footer>
      {(!desktop || error || sources.error || devicesError) && (
        <div
          className="recorder-feedback"
          role={error || sources.error || devicesError ? "alert" : "status"}
        >
          {error ||
            sources.error ||
            devicesError ||
            "Use o aplicativo desktop para gravar."}
          {props.permissionDenied && (
            <button onClick={openPermissions}>Permissões ↗</button>
          )}
        </div>
      )}
    </main>
  );
}
