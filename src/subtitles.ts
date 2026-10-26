import type { Effect } from './timeline.ts';

export function parseSrt(text: string, duration: number): Effect[] {
  const blocks = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n[\t ]*\n/);
  if (!text.trim() || blocks.length > 1000) throw new Error('A legenda deve conter de 1 a 1.000 blocos.');
  return blocks.map((block, index) => {
    const lines = block.split('\n');
    if (/^\d+$/.test(lines[0].trim())) lines.shift();
    const match = lines.shift()?.match(/^(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})\s+-->\s+(\d{2,}):([0-5]\d):([0-5]\d)[,.](\d{3})\s*$/);
    if (!match) throw new Error(`Tempo inválido no bloco ${index + 1} da legenda.`);
    const seconds = (offset: number) => Number(match[offset]) * 3600 + Number(match[offset + 1]) * 60 + Number(match[offset + 2]) + Number(match[offset + 3]) / 1000;
    const start = seconds(1), end = seconds(5), value = lines.join('\n').trim();
    if (!value || value.length > 500 || end - start < .1 - 1e-8 || start < 0 || end > duration + .05) throw new Error(`Texto ou intervalo inválido no bloco ${index + 1}. Use os tempos do vídeo original.`);
    return { id: crypto.randomUUID(), kind: 'caption', start, end: Math.min(end, duration), text: value, color: '#ffffff', x: .5, y: .87, width: .8, height: .16, opacity: 1 };
  });
}
