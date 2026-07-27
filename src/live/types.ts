/**
 * Live dashboard mode types.
 *
 * Defines the options passed to {@link startLive}, the
 * export format enum, and the input-mode union used
 * throughout the interactive session.
 */
export interface LiveOptions {
  interval: number;
  detailed?: boolean;
  exportDir?: string;
  autoLog?: boolean;
}

export type ExportFormat = 'json' | 'csv' | 'tsv';

type InputMode = null | 'filter' | 'kill' | 'signal' | 'customizer';

type SortMode = 'cpu' | 'mem' | 'pid' | 'user' | 'command' | 'state' | 'threads' | 'runtime';

type GraphMode = 'spark' | 'bar';

export type { InputMode, SortMode, GraphMode };
