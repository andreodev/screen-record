import type { MutableRefObject, RefObject } from "react";
import type { CaptureSelection } from "../capture-options";
import type { RecordingOptions } from "../recording-options";
import type { Operation } from "./types";

type NativeAction = <T>(
  name: string,
  args?: Record<string, unknown>,
) => Promise<T | undefined>;

type RecordingOperationsOptions = {
  action: NativeAction;
  video: RefObject<HTMLVideoElement | null>;
  operation: Operation;
  operationRef: MutableRefObject<Operation>;
  recordMicrophone: boolean;
  recordWebcam: boolean;
  recordSystemAudio: boolean;
  recordingOptions: RecordingOptions;
  setCaptureQuality: (quality: { resolution: number; fps: number }) => void;
  setElapsed: (elapsed: number) => void;
  setOperation: (operation: Operation) => void;
  setNotice: (notice: string) => void;
  prepareWindow: () => Promise<void>;
  setError: (message: string) => void;
};

export function createRecordingOperations(options: RecordingOperationsOptions) {
  const {
    action,
    video,
    operation,
    operationRef,
    recordMicrophone,
    recordWebcam,
    recordSystemAudio,
    recordingOptions,
    setCaptureQuality,
    setElapsed,
    setOperation,
    setNotice,
    prepareWindow,
    setError,
  } = options;

  async function record(selection: CaptureSelection) {
    if (operationRef.current !== "idle") return;
    operationRef.current = "starting";
    setCaptureQuality({ resolution: selection.resolution, fps: selection.fps });
    video.current?.pause();
    setElapsed(0);
    setOperation("starting");
    setNotice(
      recordMicrophone
        ? "Iniciando tela e áudio. Autorize o microfone se solicitado."
        : recordWebcam
          ? "Aguardando a tela e a webcam. Autorize o acesso à câmera se solicitado."
          : "Aguardando os primeiros frames da tela.",
    );
    try {
      await prepareWindow();
      await action("start_recording", {
        withWebcam: recordWebcam,
        withSystemAudio: recordSystemAudio,
        withMicrophone: recordMicrophone,
        options: { ...recordingOptions, ...selection },
      });
    } catch (cause) {
      setError(String(cause));
      setOperation("idle");
    }
  }

  async function stop() {
    setOperation(operation === "exporting" ? "exporting" : "stopping");
    const result = await action("stop_operation");
    if (result === undefined && operationRef.current === "idle") return;
  }

  return { record, stop };
}
