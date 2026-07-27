/**
 * ASCII Splash Screen implementation based on the doom-fire effect.
 */
import chalk from 'chalk';

const MAXV = 36;
const CHAR_RAMP = [' ', '.', '`', ',', ':', ';', '+', '*', '?', '%', '#', '@'];

// Colors for the fire effect
const palette = [
  '#0a0505', '#1a0806', '#2a0b06', '#3f1004', '#591404', '#791804', '#9e1c04', '#c92004',
  '#d63004', '#e34004', '#f05004', '#fd6004', '#ff7004', '#ff8004', '#ff9004', '#ffa004',
  '#ffb004', '#ffc004', '#ffd004', '#ffe004', '#fff004', '#fff820', '#ffff40', '#ffff60',
  '#ffff80', '#ffffa0', '#ffffc0', '#ffffe0', '#ffffff', '#ffffff', '#ffffff', '#ffffff',
  '#ffffff', '#ffffff', '#ffffff', '#ffffff'
];

function getRgb(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

const rgbPalette = palette.map(getRgb);

function getChar(val: number) {
  const idx = Math.min(CHAR_RAMP.length - 1, Math.floor((val / (MAXV + 1)) * CHAR_RAMP.length));
  return CHAR_RAMP[idx];
}

export async function showSplash() {
  const cols = 60;
  const rows = 15;
  let fire = new Uint8Array(cols * rows);

  // Clear screen
  process.stdout.write('\x1b[2J');
  const termRows = process.stdout.rows || 24;
  const termCols = process.stdout.columns || 80;
  const startRow = Math.max(0, Math.floor((termRows - rows) / 2));
  const startCol = Math.max(0, Math.floor((termCols - cols) / 2));

  return new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      // Bottom row heat
      for (let x = 0; x < cols; x++) {
        fire[(rows - 1) * cols + x] = MAXV - Math.floor(Math.random() * 4);
      }

      // Spread fire
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

      // Draw
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
      
      // Clear viewport area and redraw
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

    // Auto-exit after 5s
    setTimeout(onEnter, 5000);
  });
}
