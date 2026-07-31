/**
 * ASCII Splash Screen implementation based on the doom-fire effect.
 *
 * Supports configurable colour schemes and animation types via
 * the {@link SplashConfig} interface.
 */
import chalk from 'chalk';

const MAXV = 36;
const CHAR_RAMP = [' ', '.', '`', ',', ':', ';', '+', '*', '?', '%', '#', '@'];

export type SplashColorScheme = 'fire' | 'ocean' | 'forest' | 'purple' | 'monochrome';
export type SplashAnimation = 'classic' | 'wave' | 'sparks';

export interface SplashConfig {
  enabled?: boolean;
  colorScheme?: SplashColorScheme;
  animation?: SplashAnimation;
}

const PALETTES: Record<SplashColorScheme, string[]> = {
  fire: [
    '#0a0505', '#1a0806', '#2a0b06', '#3f1004', '#591404', '#791804', '#9e1c04', '#c92004',
    '#d63004', '#e34004', '#f05004', '#fd6004', '#ff7004', '#ff8004', '#ff9004', '#ffa004',
    '#ffb004', '#ffc004', '#ffd004', '#ffe004', '#fff004', '#fff820', '#ffff40', '#ffff60',
    '#ffff80', '#ffffa0', '#ffffc0', '#ffffe0', '#ffffff', '#ffffff', '#ffffff', '#ffffff',
    '#ffffff', '#ffffff', '#ffffff', '#ffffff',
  ],
  ocean: [
    '#020a1a', '#041428', '#061e36', '#0a2844', '#0e3252', '#123c60', '#16466e', '#1a507c',
    '#1e5a8a', '#226498', '#266ea6', '#2a78b4', '#2e82c2', '#328cd0', '#3696de', '#3aa0ec',
    '#3eaae8', '#42b4e4', '#46bee0', '#4ac8dc', '#4fd2d8', '#53dcd4', '#57e6d0', '#5befcc',
    '#5ff6c8', '#63ffc4', '#67ffc0', '#6bffbc', '#6fffB8', '#73ffb4', '#77ffb0', '#7bffac',
    '#7fffA8', '#83ffa4', '#87ffa0', '#8bff9c',
  ],
  forest: [
    '#020a02', '#041404', '#061e06', '#0a280a', '#0e320e', '#123c12', '#164616', '#1a501a',
    '#1e5a1e', '#226422', '#266e26', '#2a782a', '#2e822e', '#328c32', '#369636', '#3aa03a',
    '#3eaa3e', '#42b442', '#46be46', '#4ac84a', '#4fd24f', '#53dc53', '#57e657', '#5bf05b',
    '#5ff65f', '#63ff63', '#67ff67', '#6bff6b', '#6fff6f', '#73ff73', '#77ff77', '#7bff7b',
    '#7fff7f', '#83ff83', '#87ff87', '#8bff8b',
  ],
  purple: [
    '#0a021a', '#140428', '#1e0636', '#280844', '#320a52', '#3c0c60', '#460e6e', '#50107c',
    '#5a128a', '#641498', '#6e16a6', '#7818b4', '#821ac2', '#8c1cd0', '#961ede', '#a020ec',
    '#aa22e8', '#b424e4', '#be26e0', '#c828dc', '#d22ad8', '#dc2cd4', '#e62ed0', '#f030cc',
    '#f432c8', '#f834c4', '#fc36c0', '#ff38bc', '#ff3ab8', '#ff3cb4', '#ff3eb0', '#ff40ac',
    '#ff42a8', '#ff44a4', '#ff46a0', '#ff489c',
  ],
  monochrome: [
    '#0a0a0a', '#1a1a1a', '#2a2a2a', '#3a3a3a', '#4a4a4a', '#5a5a5a', '#6a6a6a', '#7a7a7a',
    '#8a8a8a', '#9a9a9a', '#aaaaaa', '#bAbAbA', '#cacaca', '#dAdAdA', '#eaeaea', '#f4f4f4',
    '#f8f8f8', '#fcfcfc', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff',
    '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff',
    '#ffffff', '#ffffff', '#ffffff', '#ffffff',
  ],
};

function getRgb(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function getPalette(scheme: SplashColorScheme) {
  return (PALETTES[scheme] ?? PALETTES.fire).map(getRgb);
}

function getChar(val: number) {
  const idx = Math.min(CHAR_RAMP.length - 1, Math.floor((val / (MAXV + 1)) * CHAR_RAMP.length));
  return CHAR_RAMP[idx];
}

function initFire(cols: number, rows: number): Uint8Array {
  return new Uint8Array(cols * rows);
}

function spreadFireClassic(fire: Uint8Array, cols: number, rows: number) {
  for (let x = 0; x < cols; x++) {
    fire[(rows - 1) * cols + x] = MAXV - Math.floor(Math.random() * 4);
  }
  for (let y = rows - 1; y >= 1; y--) {
    for (let x = 0; x < cols; x++) {
      const src = y * cols + x;
      const val = fire[src];
      if (val === 0) {
        fire[(y - 1) * cols + x] = 0;
        continue;
      }
      const decay = Math.floor(Math.random() * 3);
      const drift = Math.floor(Math.random() * 3) - 1;
      let nx = x + drift;
      if (nx < 0) nx = 0; else if (nx >= cols) nx = cols - 1;
      fire[(y - 1) * cols + nx] = Math.max(0, val - decay);
    }
  }
}

function spreadFireWave(fire: Uint8Array, cols: number, rows: number, time: number) {
  for (let x = 0; x < cols; x++) {
    const wave = Math.sin((x + time) * 0.3) * 0.5 + 0.5;
    fire[(rows - 1) * cols + x] = Math.floor(MAXV * wave);
  }
  for (let y = rows - 1; y >= 1; y--) {
    for (let x = 0; x < cols; x++) {
      const src = y * cols + x;
      const val = fire[src];
      if (val === 0) {
        fire[(y - 1) * cols + x] = 0;
        continue;
      }
      const decay = Math.floor(Math.random() * 2);
      const nx = x;
      fire[(y - 1) * cols + nx] = Math.max(0, val - decay);
    }
  }
}

function spreadFireSparks(fire: Uint8Array, cols: number, rows: number) {
  for (let x = 0; x < cols; x++) {
    fire[(rows - 1) * cols + x] = Math.random() < 0.3 ? MAXV - Math.floor(Math.random() * 4) : 0;
  }
  for (let y = rows - 1; y >= 1; y--) {
    for (let x = 0; x < cols; x++) {
      const src = y * cols + x;
      const val = fire[src];
      if (val === 0) {
        fire[(y - 1) * cols + x] = 0;
        continue;
      }
      const decay = Math.floor(Math.random() * 4);
      const drift = Math.floor(Math.random() * 5) - 2;
      let nx = x + drift;
      if (nx < 0) nx = 0; else if (nx >= cols) nx = cols - 1;
      fire[(y - 1) * cols + nx] = Math.max(0, val - decay);
    }
  }
}

export async function showSplash(config?: SplashConfig): Promise<void> {
  const enabled = config?.enabled ?? true;
  if (!enabled) return;

  const colorScheme = config?.colorScheme ?? 'fire';
  const animation = config?.animation ?? 'classic';
  const rgbPalette = getPalette(colorScheme);

  const cols = 60;
  const rows = 15;
  let fire = initFire(cols, rows);
  let time = 0;

  process.stdout.write('\x1b[2J');
  const termRows = process.stdout.rows || 24;
  const termCols = process.stdout.columns || 80;
  const startRow = Math.max(0, Math.floor((termRows - rows) / 2));
  const startCol = Math.max(0, Math.floor((termCols - cols) / 2));

  return new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      time++;

      if (animation === 'wave') {
        spreadFireWave(fire, cols, rows, time);
      } else if (animation === 'sparks') {
        spreadFireSparks(fire, cols, rows);
      } else {
        spreadFireClassic(fire, cols, rows);
      }

      let output = '';
      for (let i = 0; i < startRow; i++) output += '\n';

      for (let y = 0; y < rows; y++) {
        output += ' '.repeat(startCol);
        for (let x = 0; x < cols; x++) {
          const v = fire[y * cols + x];
          const color = rgbPalette[Math.min(v, rgbPalette.length - 1)];
          output += chalk.rgb(color.r, color.g, color.b)(getChar(v));
        }
        output += '\n';
      }
      output += ' '.repeat(Math.max(0, startCol + (cols - 45) / 2)) + chalk.bold.white('🔥 pyre — system monitor (warming up sensors...)\n');
      output += ' '.repeat(Math.max(0, startCol + (cols - 25) / 2)) + chalk.dim('[Press Enter to continue]');

      process.stdout.write(`\x1b[H${output}`);
    }, 65);

    const onEnter = () => {
      process.stdin.removeListener('data', onEnter);
      clearInterval(interval);
      process.stdout.write('\x1b[2J\x1b[H');
      resolve();
    };

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onEnter);

    setTimeout(onEnter, 1500);
  });
}