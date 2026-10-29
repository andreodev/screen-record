import { useEffect, useRef, useState, type PointerEvent } from "react";
import { dragCrop, fullCrop, normalizedCrop, type CropRect } from "./crop";
import "./crop.css";

const handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const handleNames = [
  "superior esquerdo",
  "superior",
  "superior direito",
  "direito",
  "inferior direito",
  "inferior",
  "inferior esquerdo",
  "esquerdo",
];

export function CropDialog({
  src,
  width,
  height,
  time,
  initial,
  close,
  apply,
}: {
  src: string;
  width: number;
  height: number;
  time: number;
  initial?: CropRect;
  close: () => void;
  apply: (crop?: CropRect) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    stage = useRef<HTMLDivElement>(null);
  const [crop, setCrop] = useState(() => normalizedCrop(initial));
  const [error, setError] = useState("");
  const gesture = useRef<{
    id: number;
    handle: string;
    x: number;
    y: number;
    crop: CropRect;
    bounds: DOMRect;
  } | null>(null);
  const minWidth = Math.min(1, Math.max(0.01, 16 / width)),
    minHeight = Math.min(1, Math.max(0.01, 16 / height));
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  function start(event: PointerEvent<HTMLElement>, handle: string) {
    if (event.button !== 0 || !stage.current) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = stage.current.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width,
      y = (event.clientY - bounds.top) / bounds.height;
    gesture.current = { id: event.pointerId, handle, x, y, crop, bounds };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLElement>) {
    const active = gesture.current;
    if (!active || active.id !== event.pointerId) return;
    const x = (event.clientX - active.bounds.left) / active.bounds.width,
      y = (event.clientY - active.bounds.top) / active.bounds.height;
    if (active.handle === "draw") {
      const left = Math.max(0, Math.min(active.x, x, 1 - minWidth)),
        top = Math.max(0, Math.min(active.y, y, 1 - minHeight));
      setCrop({
        x: left,
        y: top,
        width: Math.max(minWidth, Math.min(1, Math.max(active.x, x)) - left),
        height: Math.max(minHeight, Math.min(1, Math.max(active.y, y)) - top),
      });
    } else
      setCrop(
        dragCrop(
          active.crop,
          active.handle,
          x - active.x,
          y - active.y,
          minWidth,
          minHeight,
        ),
      );
  }
  function preset(ratio: number) {
    const normalized = ratio / (width / height);
    const w = Math.min(1, normalized),
      h = Math.min(1, 1 / normalized);
    setCrop({ x: (1 - w) / 2, y: (1 - h) / 2, width: w, height: h });
  }
  return (
    <dialog
      ref={dialog}
      className="crop-dialog"
      aria-labelledby="crop-title"
      aria-describedby="crop-help"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClose={close}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="crop-heading">
        <div>
          <h2 id="crop-title">Recortar vídeo</h2>
          <p id="crop-help">
            Arraste sobre o vídeo para selecionar uma área. Mova a seleção ou
            ajuste as bordas.
          </p>
        </div>
        <button autoFocus aria-label="Fechar recorte" onClick={close}>
          ×
        </button>
      </div>
      <div className="crop-presets">
        <span>Começar com</span>
        <button onClick={() => setCrop(fullCrop)}>Vídeo inteiro</button>
        <button onClick={() => preset(16 / 9)}>16:9</button>
        <button onClick={() => preset(9 / 16)}>9:16</button>
        <button onClick={() => preset(1)}>1:1</button>
      </div>
      <div className="crop-preview">
        <div
          ref={stage}
          className="crop-stage"
          style={{
            aspectRatio: `${width} / ${height}`,
            width: `min(100%, calc(min(54vh, 520px) * ${width / height}))`,
          }}
          onPointerDown={(event) => start(event, "draw")}
          onPointerMove={move}
          onPointerUp={() => {
            gesture.current = null;
          }}
          onPointerCancel={() => {
            gesture.current = null;
          }}
          onLostPointerCapture={() => {
            gesture.current = null;
          }}
        >
          <video
            src={src}
            muted
            playsInline
            preload="auto"
            onLoadedMetadata={(event) => {
              event.currentTarget.currentTime = Math.min(
                time,
                event.currentTarget.duration || time,
              );
            }}
            onError={() =>
              setError(
                "Não foi possível carregar o vídeo para recortar. Feche e tente novamente.",
              )
            }
          />
          <div
            className="crop-selection"
            role="group"
            aria-label="Área selecionada"
            style={{
              left: `${crop.x * 100}%`,
              top: `${crop.y * 100}%`,
              width: `${crop.width * 100}%`,
              height: `${crop.height * 100}%`,
            }}
            onPointerDown={(event) => start(event, "move")}
          >
            <div className="crop-grid" aria-hidden="true" />
            <button
              className="crop-move"
              aria-label="Mover área de recorte"
              title="Use as setas para mover; Shift para passos maiores"
              onKeyDown={(event) => {
                const step = event.shiftKey ? 10 : 1;
                const dx =
                  event.key === "ArrowLeft"
                    ? -step / width
                    : event.key === "ArrowRight"
                      ? step / width
                      : 0;
                const dy =
                  event.key === "ArrowUp"
                    ? -step / height
                    : event.key === "ArrowDown"
                      ? step / height
                      : 0;
                if (dx || dy) {
                  event.preventDefault();
                  setCrop(dragCrop(crop, "move", dx, dy));
                }
              }}
            />
            {handles.map((handle, index) => (
              <button
                key={handle}
                className={`crop-handle crop-handle-${handle}`}
                aria-label={`Ajustar recorte: ${handleNames[index]}`}
                onPointerDown={(event) => start(event, handle)}
                onKeyDown={(event) => {
                  const step = event.shiftKey ? 10 : 1;
                  const dx =
                    event.key === "ArrowLeft"
                      ? -step / width
                      : event.key === "ArrowRight"
                        ? step / width
                        : 0;
                  const dy =
                    event.key === "ArrowUp"
                      ? -step / height
                      : event.key === "ArrowDown"
                        ? step / height
                        : 0;
                  if (dx || dy) {
                    event.preventDefault();
                    setCrop(
                      dragCrop(crop, handle, dx, dy, minWidth, minHeight),
                    );
                  }
                }}
              />
            ))}
          </div>
        </div>
      </div>
      {error && (
        <p className="crop-error" role="alert">
          {error}
        </p>
      )}
      <div className="crop-footer">
        <output aria-live="polite">
          {Math.round(crop.width * width)} × {Math.round(crop.height * height)}{" "}
          px{" "}
          <span>
            · X {Math.round(crop.x * width)} · Y {Math.round(crop.y * height)}
          </span>
        </output>
        <div>
          <button onClick={close}>Cancelar</button>
          <button
            className="export-button"
            disabled={!!error}
            onClick={() =>
              apply(
                crop.width >= 0.999999 && crop.height >= 0.999999
                  ? undefined
                  : normalizedCrop(crop),
              )
            }
          >
            Aplicar recorte
          </button>
        </div>
      </div>
    </dialog>
  );
}
