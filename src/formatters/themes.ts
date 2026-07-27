/**
 * Visual theme definitions for the pyre dashboard.
 *
 * Each theme maps UI element roles (border, cpu, mem, …) to a
 * chalk colour function.  The {@link THEMES} record provides four
 * built-in themes; additional themes can be added by extending
 * the {@link ThemeName} union and adding an entry here.
 */
import chalk from 'chalk';

export type ThemeName = 'default' | 'dracula' | 'cyberpunk' | 'monochrome';

export interface ThemeColors {
  border: (s: string) => string;
  cpu: (s: string) => string;
  mem: (s: string) => string;
  power: (s: string) => string;
  battery: (s: string) => string;
  thermal: (s: string) => string;
  network: (s: string) => string;
  disk: (s: string) => string;
  graphs: (s: string) => string;
  process: (s: string) => string;
}

/**
 * Built-in colour themes.
 *
 * - **default** — muted greys and cyan accents, safe for any terminal.
 * - **dracula**  — the popular Dracula dark palette.
 * - **cyberpunk** — high-contrast neon on black.
 * - **monochrome** — white-only, useful for colour-blind users or
 *   terminals without 256-colour support.
 */
export const THEMES: Record<ThemeName, ThemeColors> = {
  default: {
    border: chalk.hex('#4b5563'),
    cpu: chalk.hex('#22d3ee'),
    mem: chalk.hex('#a78bfa'),
    power: chalk.hex('#fbbf24'),
    battery: chalk.hex('#34d399'),
    thermal: chalk.hex('#fb923c'),
    network: chalk.hex('#60a5fa'),
    disk: chalk.hex('#f472b6'),
    graphs: chalk.hex('#22d3ee'),
    process: chalk.hex('#e5e7eb'),
  },
  dracula: {
    border: chalk.hex('#6272a4'),
    cpu: chalk.hex('#8be9fd'),
    mem: chalk.hex('#bd93f9'),
    power: chalk.hex('#f1fa8c'),
    battery: chalk.hex('#50fa7b'),
    thermal: chalk.hex('#ffb86c'),
    network: chalk.hex('#ff79c6'),
    disk: chalk.hex('#ff5555'),
    graphs: chalk.hex('#8be9fd'),
    process: chalk.hex('#f8f8f2'),
  },
  cyberpunk: {
    border: chalk.hex('#ff0055'),
    cpu: chalk.hex('#00ffcc'),
    mem: chalk.hex('#ff00ff'),
    power: chalk.hex('#ffff00'),
    battery: chalk.hex('#00ff00'),
    thermal: chalk.hex('#ff6600'),
    network: chalk.hex('#00ffff'),
    disk: chalk.hex('#ff007f'),
    graphs: chalk.hex('#00ffcc'),
    process: chalk.hex('#ffffff'),
  },
  monochrome: {
    border: chalk.gray,
    cpu: chalk.white.bold,
    mem: chalk.white.bold,
    power: chalk.white.bold,
    battery: chalk.white.bold,
    thermal: chalk.white.bold,
    network: chalk.white.bold,
    disk: chalk.white.bold,
    graphs: chalk.white.bold,
    process: chalk.white.bold,
  },
};