import type { CaptureDevice } from './recording-options';

export function DeviceSelect({ label, value, devices, disabled, onChange }: {
  label: string; value: string | null; devices: CaptureDevice[]; disabled: boolean;
  onChange: (value: string | null) => void;
}) {
  const missing = value && !devices.some(device => device.id === value);
  const defaultDevice = devices.find(device => device.isDefault);
  return <label className="capture-device-select">
    <span>{label}</span>
    <select aria-label={label} value={value || ''} disabled={disabled} onChange={event => onChange(event.target.value || null)}>
      <option value="">{defaultDevice ? `Padrão — ${defaultDevice.label}` : 'Padrão do sistema'}</option>
      {missing && <option value={value} disabled>Dispositivo desconectado — escolha outro</option>}
      {devices.map(device => <option key={device.id} value={device.id}>{device.label}</option>)}
    </select>
  </label>;
}
