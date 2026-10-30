import type { ComponentProps, RefObject } from "react";
import { m } from "motion/react";
import type { Panel } from "../editor/types";
import { BackgroundPanel } from "./BackgroundPanel";
import { ZoomPanel } from "./ZoomPanel";
import { CursorPanel } from "./CursorPanel";
import { AnimationsPanel } from "./AnimationsPanel";
import { WebcamPanel } from "./WebcamPanel";
import { PacingPanel } from "./PacingPanel";
import { AudioPanel } from "./AudioPanel";
import { EffectPanel } from "./EffectPanel";
import { ClipPanel } from "./ClipPanel";
import { ExportRangeFields } from "./ExportRangeFields";

export type EditorInspectorProps = {
  active: Panel;
  inspectorRef: RefObject<HTMLElement | null>;
  disabled: boolean;
  panels: {
    background: ComponentProps<typeof BackgroundPanel>;
    zoom: ComponentProps<typeof ZoomPanel>;
    cursor: ComponentProps<typeof CursorPanel>;
    animations: ComponentProps<typeof AnimationsPanel>;
    webcam: ComponentProps<typeof WebcamPanel>;
    pacing: ComponentProps<typeof PacingPanel>;
    audio: ComponentProps<typeof AudioPanel>;
    effect: ComponentProps<typeof EffectPanel>;
    clip: ComponentProps<typeof ClipPanel>;
  };
  range: ComponentProps<typeof ExportRangeFields>;
};

export function EditorInspector({
  active,
  inspectorRef,
  disabled,
  panels,
  range,
}: EditorInspectorProps) {
  return (
    <aside
      className="inspector"
      ref={inspectorRef}
      aria-label="Propriedades da edição"
    >
      <fieldset disabled={disabled}>
        <m.div
          key={active}
          initial={{ opacity: 0, x: 6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.16 }}
        >
          {active === "background" && (
            <BackgroundPanel {...panels.background} />
          )}
          {active === "zoom" && <ZoomPanel {...panels.zoom} />}
          {active === "cursor" && <CursorPanel {...panels.cursor} />}
          {active === "animations" && (
            <AnimationsPanel {...panels.animations} />
          )}
          {active === "webcam" && <WebcamPanel {...panels.webcam} />}
          {active === "pacing" && <PacingPanel {...panels.pacing} />}
          {active === "audio" && <AudioPanel {...panels.audio} />}
          {active === "effect" && <EffectPanel {...panels.effect} />}
          {active === "clip" && <ClipPanel {...panels.clip} />}
        </m.div>
        <ExportRangeFields {...range} />
      </fieldset>
    </aside>
  );
}
