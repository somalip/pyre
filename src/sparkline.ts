const BLOCKS = ' ▂▃▄▅▆▇█';

/**
 * Render a series of numbers as a compact unicode sparkline.
 *
 * Values are normalised against `min`/`max` (auto-computed
 * from the data if not supplied). The output uses eight
 * Unicode block characters to represent the range, making
 * it suitable for inline terminal graphs.
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

/**
 * Render a multi-row unicode sparkline area graph.
 * Returns an array of strings representing each row from top to bottom.
 */
export function multiRowSparkline(
  values: number[],
  height: number,
  opts: { min?: number; max?: number } = {}
): string[] {
  if (!values.length || height <= 0) return Array(height).fill('');
  let min = opts.min ?? Infinity;
  let max = opts.max ?? -Infinity;
  if (opts.min === undefined || opts.max === undefined) {
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  const range = max - min || 1;
  const levels = height * 8;

  const rows: string[][] = Array.from({ length: height }, () => []);

  for (const v of values) {
    const rawSteps = Math.round(((v - min) / range) * levels);
    const totalSteps = Math.min(levels, Math.max(0, rawSteps));

    for (let r = 0; r < height; r++) {
      const rowFromBottom = height - 1 - r;
      const minForThisRow = rowFromBottom * 8;
      const stepsInThisRow = Math.min(8, Math.max(0, totalSteps - minForThisRow));

      if (stepsInThisRow === 0) {
        rows[r].push(' ');
      } else {
        rows[r].push(BLOCKS[stepsInThisRow]);
      }
    }
  }

  return rows.map(r => r.join(''));
}

/**
 * Render values as a high-density braille sparkline string.
 */
export function brailleGraph(values: number[], opts: { min?: number; max?: number } = {}): string {
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

  const dotsCol0 = [0x40, 0x04, 0x02, 0x01]; // bottom to top
  const dotsCol1 = [0x80, 0x20, 0x10, 0x08]; // bottom to top

  let result = '';
  for (let i = 0; i < values.length; i += 2) {
    const v0 = values[i];
    const v1 = i + 1 < values.length ? values[i + 1] : v0;

    const fill0 = Math.min(4, Math.max(0, Math.round(((v0 - min) / range) * 4)));
    const fill1 = Math.min(4, Math.max(0, Math.round(((v1 - min) / range) * 4)));

    let code = 0x2800;
    for (let d = 0; d < fill0; d++) code |= dotsCol0[d];
    for (let d = 0; d < fill1; d++) code |= dotsCol1[d];

    result += String.fromCharCode(code);
  }

  return result;
}
