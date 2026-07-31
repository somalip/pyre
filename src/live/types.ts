/**
 * Live dashboard mode types.
 *
 * Defines the options passed to {@link startLive}, the
 * export format enum, and the input-mode union used
 * throughout the interactive session.
 */
import type { ThemeName } from '../formatters/themes.js';

export interface LiveOptions {
  interval: number;
  detailed?: boolean;
  exportDir?: string;
  autoLog?: boolean;
  theme?: ThemeName;
  alertCpu?: number;
  alertTemp?: number;
  tempUnit?: 'c' | 'f';
}

export type ExportFormat = 'json' | 'csv' | 'tsv' | 'html' | 'md';

type InputMode = null | 'filter' | 'kill' | 'signal' | 'customizer' | 'p2p' | 'menu' | 'readme' | 'credits';

type SortMode = 'cpu' | 'mem' | 'pid' | 'user' | 'command' | 'state' | 'threads' | 'runtime';

type GraphMode = 'spark' | 'bar';

type ActivePanel = 'grid' | 'cpu' | 'mem' | 'gpu' | 'power' | 'battery' | 'thermal' | 'network' | 'packets' | 'tasks' | 'disk' | 'process' | 'p2p';

export type { InputMode, SortMode, GraphMode, ActivePanel, ThemeName };

