const BLOCKS = '▁▂▃▄▅▆▇█';

/**
 * Render a series of numbers as a compact unicode sparkline.
 *
 * Values are normalised against `min`/`max` (auto-computed
 * from the data if not supplied).  The output uses eight
 * Unicode block characters to represent the range, making
 * it suitable for inline terminal graphs.
 *
 * @param values - Numeric series to render.
 * @param opts.min - Minimum value for normalisation.
 * @param opts.max - Maximum value for normalisation.
 * @returns A string of block characters whose length equals `values.length`.
 *
 * @example
 * ```ts
 * sparkline([10, 20, 15, 30, 25]); // "▁▂▃▅▄"
 * ```
 */
export function sparkline(values: number[], opts: { min?: number; max?: number } = {}): string {
  if (!values.length) return '';
  let min = opts.min ?? Infinity;
  let max = opts.max ?? -Infinity;
  if (opts.min === undefined || opts.max === undefined) {
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  const range = max - min || 1;

  return values
    .map(v => {
      const idx = Math.round(((v - min) / range) * (BLOCKS.length - 1));
      const clamped = Math.min(BLOCKS.length - 1, Math.max(0, idx));
      return BLOCKS[clamped];
    })
    .join('');
}