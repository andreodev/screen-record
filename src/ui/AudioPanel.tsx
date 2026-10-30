import type { Dispatch, SetStateAction } from "react";
import { DeviceSelect } from "../DeviceSelect";
import type { Media, Project } from "../editor/types";
import {
  microphonePresets,
  type MicrophoneProcessing,
  type RecordingDevices,
  type RecordingOptions,
} from "../recording-options";
import type { Appearance } from "../zoom";
import { AppIcon } from "./AppIcon";
import { RangeField as Range } from "./RangeField";

type AudioPanelProps = {
  busy: boolean;
  recordMicrophone: boolean;
  setRecordMicrophone: Dispatch<SetStateAction<boolean>>;
  windowsDesktop: boolean;
  recordingOptions: RecordingOptions;
  recordingDevices: RecordingDevices;
  devicesLoading: boolean;
  setRecordingOptions: Dispatch<SetStateAction<RecordingOptions>>;
  recordSystemAudio: boolean;
  setRecordSystemAudio: Dispatch<SetStateAction<boolean>>;
  refreshDevices: () => void | Promise<void>;
  devicesError: string | null;
  microphonePreset: string;
  microphoneProcessing: MicrophoneProcessing;
  updateMicrophoneProcessing: (patch: Partial<MicrophoneProcessing>) => void;
  action: (command: string) => Promise<unknown>;
  project: Project | null;
  media: Media | null;
  edit: (update: (project: Project) => Project) => void;
  look: Appearance;
  canEditCursor: boolean;
  appearance: (patch: Partial<Appearance>) => void;
  setClickSoundVolume: (value: number) => void;
  setBackgroundVolume: (value: number) => void;
  chooseBackgroundAudio: () => void | Promise<void>;
};

export function AudioPanel(props: AudioPanelProps) {
  const {
    busy,
    recordMicrophone,
    setRecordMicrophone,
    windowsDesktop,
    recordingOptions,
    recordingDevices,
    devicesLoading,
    setRecordingOptions,
    recordSystemAudio,
    setRecordSystemAudio,
    refreshDevices,
    devicesError,
    microphonePreset,
    microphoneProcessing,
    updateMicrophoneProcessing,
    action,
    project,
    media,
    edit,
    look,
    canEditCursor,
    appearance,
    setClickSoundVolume,
    setBackgroundVolume,
    chooseBackgroundAudio,
  } = props;
  return (
    <>
      <div className="panel-title">
        <h2>Áudio</h2>
        <span>Trilha e efeitos sonoros</span>
      </div>
      <h3>Próxima gravação</h3>
      <label className="switch-label">
        Gravar microfone
        <input
          type="checkbox"
          disabled={busy}
          checked={recordMicrophone}
          onChange={(e) => setRecordMicrophone(e.target.checked)}
        />
      </label>
      {windowsDesktop && (
        <DeviceSelect
          label="Microfone para gravar"
          value={recordingOptions.microphoneDevice}
          devices={recordingDevices.inputs}
          disabled={busy || devicesLoading || !recordMicrophone}
          onChange={(microphoneDevice) =>
            setRecordingOptions((options) => ({
              ...options,
              microphoneDevice,
            }))
          }
        />
      )}
      <label className="switch-label">
        Áudio do sistema
        <input
          type="checkbox"
          disabled={busy}
          checked={recordSystemAudio}
          onChange={(e) => setRecordSystemAudio(e.target.checked)}
        />
      </label>
      {windowsDesktop && (
        <>
          <DeviceSelect
            label="Saída de áudio a gravar"
            value={recordingOptions.outputDevice}
            devices={recordingDevices.outputs}
            disabled={busy || devicesLoading || !recordSystemAudio}
            onChange={(outputDevice) =>
              setRecordingOptions((options) => ({
                ...options,
                outputDevice,
              }))
            }
          />
          <p className="help">
            Escolha os fones ou alto-falantes onde o áudio que você quer gravar
            está sendo reproduzido.
          </p>
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
          <div className="section-line" />
          <h3>Voz limpa na gravação</h3>
          <fieldset
            disabled={busy || !recordMicrophone}
            className="microphone-processing"
          >
            <label className="capture-device-select">
              <span>Tratamento da voz</span>
              <select
                aria-label="Tratamento da voz"
                value={microphonePreset}
                onChange={(event) =>
                  setRecordingOptions((options) => ({
                    ...options,
                    microphoneProcessing: {
                      ...microphonePresets[event.target.value],
                    },
                  }))
                }
              >
                <option value="natural">Natural · recomendado</option>
                <option value="noisy">Ambiente ruidoso</option>
                <option value="off">Sem processamento</option>
                <option value="custom" disabled>
                  Personalizado
                </option>
              </select>
            </label>
            <label className="switch-label">
              Supressão de ruído
              <input
                type="checkbox"
                checked={microphoneProcessing.noiseSuppression}
                onChange={(event) =>
                  updateMicrophoneProcessing({
                    noiseSuppression: event.target.checked,
                  })
                }
              />
            </label>
            {microphoneProcessing.noiseSuppression && (
              <Range
                label="Redução de ruído"
                min={6}
                max={30}
                suffix=" dB"
                value={microphoneProcessing.noiseReduction}
                onChange={(noiseReduction) =>
                  updateMicrophoneProcessing({ noiseReduction })
                }
              />
            )}
            <label className="switch-label">
              Compressor de voz
              <input
                type="checkbox"
                checked={microphoneProcessing.compressor}
                onChange={(event) =>
                  updateMicrophoneProcessing({
                    compressor: event.target.checked,
                  })
                }
              />
            </label>
            <details className="microphone-advanced">
              <summary>Ajustes avançados</summary>
              <label className="switch-label">
                Cortar ruídos graves (80 Hz)
                <input
                  type="checkbox"
                  checked={microphoneProcessing.highPass}
                  onChange={(event) =>
                    updateMicrophoneProcessing({
                      highPass: event.target.checked,
                    })
                  }
                />
              </label>
              <fieldset disabled={!microphoneProcessing.compressor}>
                <Range
                  label="Limiar do compressor"
                  min={-36}
                  max={-6}
                  suffix=" dB"
                  value={microphoneProcessing.thresholdDb}
                  onChange={(thresholdDb) =>
                    updateMicrophoneProcessing({ thresholdDb })
                  }
                />
                <Range
                  label="Razão do compressor"
                  min={1}
                  max={8}
                  step={0.5}
                  suffix=":1"
                  value={microphoneProcessing.ratio}
                  onChange={(ratio) => updateMicrophoneProcessing({ ratio })}
                />
                <Range
                  label="Ganho da voz"
                  min={0}
                  max={12}
                  suffix=" dB"
                  value={microphoneProcessing.makeupDb}
                  onChange={(makeupDb) =>
                    updateMicrophoneProcessing({ makeupDb })
                  }
                />
              </fieldset>
            </details>
            <p className="help">
              A supressão reduz o ruído de fundo e o compressor equilibra o
              volume da voz. O tratamento é aplicado enquanto você grava e fica
              salvo na trilha do microfone.
            </p>
          </fieldset>
        </>
      )}
      <p className="help">
        A voz fica em uma trilha independente. Autorize o acesso ao microfone se
        solicitado pelo sistema.
      </p>
      <button
        className="wide subtle"
        onClick={() => void action("open_microphone_settings")}
      >
        Permissão do microfone ↗
      </button>
      {project && media?.hasAudio && (
        <Range
          label="Volume da gravação / sistema"
          min={0}
          max={100}
          suffix="%"
          value={(project.sourceVolume ?? 1) * 100}
          onChange={(v) => edit((p) => ({ ...p, sourceVolume: v / 100 }))}
        />
      )}
      {project?.microphone && (
        <Range
          label="Volume do microfone"
          min={0}
          max={100}
          suffix="%"
          value={project.microphone.volume * 100}
          onChange={(v) =>
            edit((p) => ({
              ...p,
              microphone: p.microphone
                ? { ...p.microphone, volume: v / 100 }
                : undefined,
            }))
          }
        />
      )}
      <div className="section-line" />
      <h3>Cliques do mouse</h3>
      <label className="switch-label">
        Reproduzir som nos cliques
        <input
          type="checkbox"
          checked={look.clickSounds !== false}
          disabled={!canEditCursor || busy}
          onChange={(e) => appearance({ clickSounds: e.target.checked })}
        />
      </label>
      {look.clickSounds !== false && (
        <Range
          label="Volume dos cliques"
          min={0}
          max={100}
          step={1}
          suffix="%"
          value={(look.clickSoundVolume ?? 0.3) * 100}
          onChange={(value) => setClickSoundVolume(value / 100)}
        />
      )}
      <p className="help">
        Os efeitos acompanham os cliques gravados no preview e no vídeo
        exportado.
      </p>
      <div className="section-line" />
      {project?.backgroundAudio ? (
        <>
          <div className="background-audio-file">
            <AppIcon name="audio" />
            <span>
              <strong>{project.backgroundAudio.path.split("/").pop()}</strong>
              <small>Repetida até o final da edição</small>
            </span>
          </div>
          <Range
            label="Volume da música"
            min={0}
            max={100}
            step={1}
            suffix="%"
            value={project.backgroundAudio.volume * 100}
            onChange={(value) => setBackgroundVolume(value / 100)}
          />
          <button
            className="wide subtle"
            onClick={() => void chooseBackgroundAudio()}
          >
            Trocar arquivo
          </button>
          <button
            className="wide danger"
            onClick={() =>
              edit((p) => ({
                ...p,
                version: 6,
                backgroundAudio: undefined,
              }))
            }
          >
            Remover música
          </button>
        </>
      ) : (
        <>
          <p className="help">
            Adicione uma trilha MP3, M4A, AAC, WAV ou AIFF. Ela será repetida
            para cobrir toda a edição.
          </p>
          <button
            className="wide subtle"
            onClick={() => void chooseBackgroundAudio()}
          >
            ＋ Adicionar música
          </button>
        </>
      )}
      <p className="help">
        O áudio original do vídeo continua preservado. O volume controla somente
        a música.
      </p>
    </>
  );
}
