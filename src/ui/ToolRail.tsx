import type { Panel } from "../editor/types";
import { AppIcon } from "./AppIcon";
import { m } from "motion/react";

const tools: ReadonlyArray<readonly [Panel, string]> = [
  ["background", "Aparência"],
  ["zoom", "Zooms"],
  ["cursor", "Cursor"],
  ["animations", "Animações"],
  ["audio", "Áudio"],
  ["effect", "Anotações"],
  ["pacing", "Ritmo"],
  ["webcam", "Webcam"],
];

export function ToolRail({
  active,
  onChange,
}: {
  active: Panel;
  onChange: (panel: Panel) => void;
}) {
  return (
    <nav className="inspector-tabs" aria-label="Ferramentas do editor">
      {tools.map(([key, label]) => (
        <button
          key={key}
          className={active === key ? "active" : ""}
          onClick={() => onChange(key)}
          title={label}
          aria-label={label}
          aria-pressed={active === key}
        >
          {active === key && (
            <m.span
              className="tool-active-indicator"
              layoutId="active-tool"
              transition={{ type: "spring", stiffness: 450, damping: 35 }}
            />
          )}
          <AppIcon name={key} />
        </button>
      ))}
    </nav>
  );
}
