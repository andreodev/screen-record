import type { CaptureDevice } from "../recording-options";
import { AppIcon } from "../ui/AppIcon";

type RecorderDeviceProps = {
  label: string;
  icon: string;
  enabled: boolean;
  toggle: () => void;
  value: string | null;
  onChange: (value: string | null) => void;
  devices: CaptureDevice[];
  disabled: boolean;
};

export function RecorderDevice({
  label,
  icon,
  enabled,
  toggle,
  value,
  onChange,
  devices,
  disabled,
}: RecorderDeviceProps) {
  const missing = value && !devices.some((device) => device.id === value);
  return (
    <div className={`recorder-device ${enabled ? "enabled" : ""}`}>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={label}
        disabled={disabled}
        onClick={toggle}
      >
        <AppIcon name={icon} />
      </button>
      <label>
        <span>
          {label}
          <small>{enabled ? "Ligado" : "Desligado"}</small>
        </span>
        <select
          aria-label={`Dispositivo de ${label.toLowerCase()}`}
          disabled={disabled || !enabled}
          value={value ?? ""}
          onChange={(event) => onChange(event.target.value || null)}
        >
          <option value="">Padrão do sistema</option>
          {missing && (
            <option value={value} disabled>
              Dispositivo desconectado
            </option>
          )}
          {devices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
