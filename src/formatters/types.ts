/**
 * Public-facing type definitions for the formatters module.
 *
 * These interfaces control how the dashboard is laid out and
 * which panels are visible.  They are consumed by both the
 * static `formatTable` function and the live dashboard in
 * `live/`.
 */
import type { ThemeName } from './themes.js';
import type { StatsData } from '../monitors/types.js';
import type { History } from '../history.js';

export type { ThemeName };

export interface ThemeColors {
   border: (s: string) => string;
   cpu: (s: string) => string;
   mem: (s: string) => string;
   gpu: (s: string) => string;
   power: (s: string) => string;
   battery: (s: string) => string;
   thermal: (s: string) => string;
   network: (s: string) => string;
   disk: (s: string) => string;
   graphs: (s: string) => string;
   process: (s: string) => string;
   blender: (s: string) => string;
}

export type { StatsData };

export interface VisibleItems {
   cpu?: boolean;
   mem?: boolean;
   gpu?: boolean;
   power?: boolean;
   battery?: boolean;
   thermal?: boolean;
   network?: boolean;
   packets?: boolean;
   tasks?: boolean;
   disk?: boolean;
   process?: boolean;
   containers?: boolean;
   blender?: boolean;
   ports?: boolean;
   tree?: boolean;
}

export interface AnomalyAlert {
  metric: string;
  value: number;
  zScore: number;
  severity: 'warning' | 'critical';
  timestamp?: Date;
}

export interface TableOptions {
    /** Terminal width in columns; controls layout, bar sizing, and column count. Defaults to 80. */
    width?: number;
    /** Terminal height in rows; controls vertical panel budgeting so boxes never clip. */
    height?: number;
    /** Whether inline history graphs are enabled in dashboard panels. Defaults to true. */
    showGraphs?: boolean;
    /** Process sort key. Defaults to 'cpu'. */
    sortBy?: 'cpu' | 'mem' | 'pid' | 'user' | 'command' | 'state' | 'threads' | 'runtime';
    /** Whether to reverse the process sort direction. */
    sortReverse?: boolean;
    /** Case-insensitive substring filter applied to the process command. */
    filter?: string;
    /** Max process rows to show (the live dashboard sizes this to available terminal height). */
    processLimit?: number;
    /** Selected visual theme. */
    theme?: ThemeName;
    /** Visibility toggle settings for individual cards. */
    visible?: VisibleItems;
    /** Show process tree view instead of flat list. */
    treeView?: boolean;
    /** Active panel for detail/focus view. 'grid' means show all panels. */
    activePanel?: 'grid' | 'cpu' | 'mem' | 'gpu' | 'power' | 'battery' | 'thermal' | 'network' | 'packets' | 'tasks' | 'disk' | 'process' | 'p2p' | 'anomalies' | 'containers' | 'blender' | 'ports';
    /** Active anomaly alerts from the statistical detector. */
    anomalies?: AnomalyAlert[];
    /** Historical anomaly alerts for the anomalies tab. */
    anomalyHistory?: AnomalyAlert[];
    /** Temperature display unit: 'c' or 'f'. */
    tempUnit?: 'c' | 'f';
    /** Rolling history instance for live graphs. */
    history?: History;
    /** Graph mode: 'spark' or 'bar'. */
    graphMode?: 'spark' | 'bar';
    /** Panel layout order. */
    panelLayout?: string[];
    /** Currently selected process index for highlight. */
    selectedProcessIndex?: number;
    /** Currently tracked PID. */
    trackedPid?: number | null;
    /** Rolling CPU and Memory history for the currently tracked PID. */
    trackedPidHistory?: { cpu: number[]; mem: number[] };
    /** Currently inspected process details for modal overlay. */
    inspectProcess?: any;
    /** Minimal mode: renders only CPU, GPU, Memory, and Temperature as large glanceable gauges. */
    minimal?: boolean;
    /** Current selected AI diagnosis model ID. */
    aiModel?: string;
    /** Animation frame counter for 3D ASCII/Braille sprites and animated UI elements. */
    animFrame?: number;
    /** Selected 3D sprite mode ('ignis' | 'torus' | 'tesseract' | 'reactor' | 'prism'). */
    sprite3dMode?: 'ignis' | 'torus' | 'tesseract' | 'reactor' | 'prism';
}

