const BLOCKS = '▁▂▃▄▅▆▇█';

/**
 * Render a series of numbers as a compact unicode sparkline.
 * Values are normalized against min/max (auto-computed if not provided).
 */
export function sparkline(values: number[], opts: { min?: number; max?: number } = {}): string {
  if (!values.length) return '';
  const min = opts.min ?? Math.min(...values);
  const max = opts.max ?? Math.max(...values);
  const range = max - min || 1;

  return values
    .map(v => {
      const idx = Math.round(((v - min) / range) * (BLOCKS.length - 1));
      const clamped = Math.min(BLOCKS.length - 1, Math.max(0, idx));
      return BLOCKS[clamped];
    })
    .join('');
}