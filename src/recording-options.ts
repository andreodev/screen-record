export type MicrophoneProcessing = {
  noiseSuppression: boolean; noiseReduction: number; highPass: boolean;
  compressor: boolean; thresholdDb: number; ratio: number; makeupDb: number;
};
export type RecordingOptions = {
  outputDevice: string | null; microphoneDevice: string | null; cameraDevice: string | null;
  microphoneProcessing: MicrophoneProcessing;
};
export type CaptureDevice = { id: string; label: string; isDefault: boolean };
export type RecordingDevices = { supported: boolean; outputs: CaptureDevice[]; inputs: CaptureDevice[]; cameras: CaptureDevice[] };
export const microphonePresets: Record<string, MicrophoneProcessing> = {
  natural: { noiseSuppression: true, noiseReduction: 12, highPass: true, compressor: true, thresholdDb: -18, ratio: 3, makeupDb: 3 },
  noisy: { noiseSuppression: true, noiseReduction: 24, highPass: true, compressor: true, thresholdDb: -20, ratio: 4, makeupDb: 3 },
  off: { noiseSuppression: false, noiseReduction: 12, highPass: false, compressor: false, thresholdDb: -18, ratio: 3, makeupDb: 0 },
};
const key = 'frame-studio-recording-options';
export function normalizeRecordingOptions(value: unknown): RecordingOptions {
  const data = value && typeof value === 'object' ? value as Partial<RecordingOptions> : {};
  const raw = data.microphoneProcessing && typeof data.microphoneProcessing === 'object' ? data.microphoneProcessing : {} as Partial<MicrophoneProcessing>;
  const p = { ...microphonePresets.natural };
  for (const field of ['noiseSuppression', 'highPass', 'compressor'] as const) if (typeof raw[field] === 'boolean') p[field] = raw[field];
  for (const [field, low, high] of [['noiseReduction', 6, 30], ['thresholdDb', -36, -6], ['ratio', 1, 8], ['makeupDb', 0, 12]] as const) {
    const number = raw[field]; if (typeof number === 'number' && Number.isFinite(number)) p[field] = Math.max(low, Math.min(high, number));
  }
  const id = (value: unknown) => typeof value === 'string' && value.length <= 4096 && !value.includes('\0') && value ? value : null;
  return { outputDevice: id(data.outputDevice), microphoneDevice: id(data.microphoneDevice), cameraDevice: id(data.cameraDevice), microphoneProcessing: p };
}
export function loadRecordingOptions(): RecordingOptions {
  try { return normalizeRecordingOptions(JSON.parse(localStorage.getItem(key) || '{}')); } catch { return normalizeRecordingOptions(null); }
}
export function saveRecordingOptions(options: RecordingOptions) {
  try { localStorage.setItem(key, JSON.stringify(options)); } catch { /* Recording still works when storage is unavailable. */ }
}
