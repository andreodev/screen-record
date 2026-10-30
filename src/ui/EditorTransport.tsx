import { formatTime } from "../timeline";
import { AppIcon } from "./AppIcon";

type EditorTransportProps = {
  currentTime: number;
  duration: number;
  playing: boolean;
  disabled: boolean;
  rate: number;
  onStart: () => void;
  onTogglePlay: () => void | Promise<void>;
  onEnd: () => void;
  onRateChange: (rate: number) => void;
};

export function EditorTransport({
  currentTime,
  duration,
  playing,
  disabled,
  rate,
  onStart,
  onTogglePlay,
  onEnd,
  onRateChange,
}: EditorTransportProps) {
  return (
    <div className="transport">
      <span className="timecode">{formatTime(currentTime)}</span>
      <button
        disabled={disabled}
        onClick={onStart}
        aria-label="Voltar ao início"
      >
        |◁
      </button>
      <button
        className="play-button"
        disabled={disabled}
        onClick={() => void onTogglePlay()}
        aria-label={playing ? "Pausar" : "Reproduzir"}
      >
        <AppIcon name={playing ? "pause" : "play"} />
      </button>
      <button disabled={disabled} onClick={onEnd} aria-label="Ir ao fim">
        ▷|
      </button>
      <span className="timecode">{formatTime(duration)}</span>
      <select
        className="speed"
        aria-label="Velocidade da prévia"
        value={rate}
        onChange={(event) => onRateChange(Number(event.target.value))}
      >
        <option value={0.5}>0.5×</option>
        <option value={1}>1×</option>
        <option value={1.5}>1.5×</option>
        <option value={2}>2×</option>
      </select>
    </div>
  );
}
