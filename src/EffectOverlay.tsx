import { useMemo, type PointerEvent, type CSSProperties } from 'react';
import { annotationImage, effectLabels, graphicEffect } from './annotations';
import { clamp } from './zoom';
import type { Effect } from './timeline';

export function EffectOverlay({ effect, selected, sourceAspect, select, change, drag }: {
  effect: Effect; selected: boolean; sourceAspect: number; select: () => void;
  change: (patch: Partial<Effect>) => void;
  drag: (event: PointerEvent<HTMLElement>, effect: Effect, kind?: 'move' | 'resize') => void;
}) {
  const image = useMemo(() => graphicEffect(effect.kind) ? annotationImage(effect, sourceAspect) : '', [effect.kind, effect.text, effect.color, effect.width, effect.height, sourceAspect]);
  return <div className={`preview-effect ${effect.kind} ${selected ? 'selected' : ''}`}
    data-effect-start={effect.start} data-effect-end={effect.end} data-effect-id={effect.id}
    role="button" tabIndex={0} aria-label={`${effectLabels[effect.kind]}, arraste para mover`}
    onPointerDown={event => { select(); drag(event, effect); }} onFocus={select}
    onClick={event => { event.stopPropagation(); select(); }}
    onKeyDown={event => {
      const dx = event.key === 'ArrowLeft' ? -.01 : event.key === 'ArrowRight' ? .01 : 0;
      const dy = event.key === 'ArrowUp' ? -.01 : event.key === 'ArrowDown' ? .01 : 0;
      if (dx || dy) { event.preventDefault(); event.stopPropagation(); change({ x: clamp(effect.x + dx, effect.width / 2, 1 - effect.width / 2), y: clamp(effect.y + dy, effect.height / 2, 1 - effect.height / 2) }); }
    }}
    style={{ left: `${(effect.x - effect.width / 2) * 100}%`, top: `${(effect.y - effect.height / 2) * 100}%`, width: `${effect.width * 100}%`, height: `${effect.height * 100}%`, '--effect-opacity': effect.opacity } as CSSProperties}>
    {image && <img src={image} alt="" draggable={false} style={{ opacity: effect.opacity }} />}
    {effect.kind === 'magnifier' && <canvas aria-hidden="true" />}
    {selected && <span className="effect-resize" role="button" tabIndex={0} aria-label="Redimensionar anotação"
      onPointerDown={event => drag(event, effect, 'resize')}
      onKeyDown={event => {
        const dw = event.key === 'ArrowLeft' ? -.01 : event.key === 'ArrowRight' ? .01 : 0;
        const dh = event.key === 'ArrowUp' ? -.01 : event.key === 'ArrowDown' ? .01 : 0;
        if (dw || dh) { event.preventDefault(); event.stopPropagation(); change({ width: clamp(effect.width + dw, .04, 2 * Math.min(effect.x, 1 - effect.x)), height: clamp(effect.height + dh, .04, 2 * Math.min(effect.y, 1 - effect.y)) }); }
      }} />}
  </div>;
}
