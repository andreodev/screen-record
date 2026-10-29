import type { Effect } from "./timeline.ts";

export const effectLabels: Record<Effect["kind"], string> = {
  caption: "Legenda",
  watermark: "Marca d’água",
  mask: "Desfoque",
  highlight: "Destaque",
  text: "Texto",
  arrow: "Seta",
  rectangle: "Retângulo",
  ellipse: "Elipse",
  spotlight: "Spotlight",
  magnifier: "Lupa",
};
export const canvasEffect = (kind: Effect["kind"]) =>
  kind === "caption" || kind === "watermark";
export const graphicEffect = (kind: Effect["kind"]) =>
  ["text", "caption", "watermark", "arrow", "rectangle", "ellipse"].includes(
    kind,
  );

export function wrapText(
  text: string,
  width: number,
  measure: (text: string) => number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const char of paragraph) {
      if (line && measure(line + char) > width) {
        lines.push(line.trimEnd());
        line = "";
      }
      line += char;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

/** One static graphic per annotation; the same pixels are used by preview and both exporters. */
export function annotationImage(effect: Effect, sourceAspect: number): string {
  const canvas = document.createElement("canvas");
  const density = Math.min(1920, 1920 * sourceAspect);
  canvas.width = Math.max(16, Math.round(effect.width * density));
  canvas.height = Math.max(
    16,
    Math.round((effect.height * density) / sourceAspect),
  );
  const ctx = canvas.getContext("2d")!;
  const { width: w, height: h } = canvas,
    stroke = Math.max(3, Math.min(w, h) * 0.06);
  ctx.strokeStyle = ctx.fillStyle = effect.color ?? "#ffd55d";
  ctx.lineWidth = stroke;
  ctx.lineJoin = ctx.lineCap = "round";
  if (["text", "caption", "watermark"].includes(effect.kind)) {
    let fontSize = Math.min(h * 0.65, w * 0.16, 96);
    let lines: string[] = [];
    do {
      ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      lines = wrapText(
        effect.text ?? "Seu texto",
        w - 12,
        (line) => ctx.measureText(line).width,
      );
      if (lines.length * fontSize * 1.25 <= h - 8 || fontSize <= 6) break;
      fontSize *= 0.9;
    } while (true);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "#000";
    ctx.shadowBlur = fontSize * 0.16;
    lines.forEach((line, i) =>
      ctx.fillText(
        line,
        w / 2,
        h / 2 + (i - (lines.length - 1) / 2) * fontSize * 1.25,
      ),
    );
  } else if (effect.kind === "arrow") {
    const head = Math.min(w, h) * 0.3;
    ctx.beginPath();
    ctx.moveTo(stroke, h - stroke);
    ctx.lineTo(w - stroke, stroke);
    ctx.moveTo(w - stroke - head, stroke);
    ctx.lineTo(w - stroke, stroke);
    ctx.lineTo(w - stroke, stroke + head);
    ctx.stroke();
  } else if (effect.kind === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(
      w / 2,
      h / 2,
      (w - stroke * 2) / 2,
      (h - stroke * 2) / 2,
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  } else {
    ctx.strokeRect(stroke, stroke, w - stroke * 2, h - stroke * 2);
  }
  return canvas.toDataURL("image/png");
}
