/**
 * Public-facing type definitions for the formatters module.
 *
 * These interfaces control how the dashboard is laid out and
 * which panels are visible.  They are consumed by both the
 * static `formatTable` function and the live dashboard in
 * `live/`.
 */
import type { ThemeName } from './themes.js';

export type { ThemeName };

export interface VisibleItems {
   cpu?: boolean;
   mem?: boolean;
   gpu?: boolean;
   power?: boolean;
   battery?: boolean;
   thermal?: boolean;
   network?: boolean;
   disk?: boolean;
   process?: boolean;
   tree?: boolean;
}

export interface TableOptions {
   /** Terminal width in columns; controls layout, bar sizing, and column count. Defaults to 80. */
   width?: number;
   /** Process sort key. Defaults to 'cpu'. */
   sortBy?: 'cpu' | 'mem' | 'pid' | 'user' | 'command' | 'state' | 'threads' | 'runtime';
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
}