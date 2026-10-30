import { invoke } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  loadRecordingOptions,
  microphonePresets,
  saveRecordingOptions,
  type MicrophoneProcessing,
  type RecordingDevices,
} from "../recording-options";

type CaptureSetupOptions = {
  desktop: boolean;
  busy: boolean;
  setError: Dispatch<SetStateAction<string>>;
};

const emptyDevices: RecordingDevices = {
  supported: false,
  outputs: [],
  inputs: [],
  cameras: [],
};

export function useCaptureSetup({
  desktop,
  busy,
  setError,
}: CaptureSetupOptions) {
  const [capturePermissionDenied, setCapturePermissionDenied] = useState(false);
  const [captureQuality, setCaptureQuality] = useState({
    resolution: 2160,
    fps: 60,
  });
  const [cropOpen, setCropOpen] = useState(false);
  const [recordWebcam, setRecordWebcam] = useState(false);
  const [recordSystemAudio, setRecordSystemAudio] = useState(true);
  const [recordMicrophone, setRecordMicrophone] = useState(true);
  const [recordingOptions, setRecordingOptions] =
    useState(loadRecordingOptions);
  const [recordingDevices, setRecordingDevices] = useState(emptyDevices);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState("");
  const [cameraPreviewError, setCameraPreviewError] = useState("");
  const cameraPreviewQueue = useRef(Promise.resolve());

  const microphoneProcessing = recordingOptions.microphoneProcessing;
  const microphonePreset =
    Object.keys(microphonePresets).find((key) =>
      Object.entries(microphonePresets[key]).every(
        ([field, value]) =>
          microphoneProcessing[field as keyof MicrophoneProcessing] === value,
      ),
    ) || "custom";

  const updateMicrophoneProcessing = (patch: Partial<MicrophoneProcessing>) =>
    setRecordingOptions((options) => ({
      ...options,
      microphoneProcessing: { ...options.microphoneProcessing, ...patch },
    }));

  useEffect(() => saveRecordingOptions(recordingOptions), [recordingOptions]);

  const refreshDevices = useCallback(async () => {
    if (!desktop || busy) return;
    setDevicesLoading(true);
    setDevicesError("");
    try {
      setRecordingDevices(
        await invoke<RecordingDevices>("list_recording_devices"),
      );
    } catch (cause) {
      setDevicesError(String(cause));
    } finally {
      setDevicesLoading(false);
    }
  }, [desktop, busy]);

  useEffect(() => {
    void refreshDevices();
    const refresh = () => void refreshDevices();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refreshDevices]);

  useEffect(() => {
    if (!desktop) return;
    cameraPreviewQueue.current = cameraPreviewQueue.current
      .catch(() => undefined)
      .then(async () => {
        if (recordWebcam) {
          await invoke("start_camera_preview", {
            deviceId: recordingOptions.cameraDevice,
          });
        } else {
          await invoke("stop_camera_preview");
        }
      })
      .catch((cause) => {
        const message = String(cause);
        setCameraPreviewError(message);
        setError(message);
      });
  }, [desktop, recordWebcam, recordingOptions.cameraDevice, setError]);

  return {
    capturePermissionDenied,
    setCapturePermissionDenied,
    captureQuality,
    setCaptureQuality,
    cropOpen,
    setCropOpen,
    recordWebcam,
    setRecordWebcam,
    recordSystemAudio,
    setRecordSystemAudio,
    recordMicrophone,
    setRecordMicrophone,
    recordingOptions,
    setRecordingOptions,
    recordingDevices,
    devicesLoading,
    devicesError,
    cameraPreviewError,
    setCameraPreviewError,
    microphoneProcessing,
    microphonePreset,
    updateMicrophoneProcessing,
    refreshDevices,
  };
}
