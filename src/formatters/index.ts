/**
 * pyre formatters module.
 *
 * Provides dashboard rendering (`formatTable`), data export
 * (`formatJson`, `formatCsv`, `formatTsv`), and graph
 * rendering (`formatGraphs`) for the live dashboard.
 *
 * The module is organised into four sub-files:
 * - `types.ts`  — public-facing type definitions
 * - `themes.ts` — colour theme definitions
 * - `render.ts` — dashboard layout, cards, tables, and the main `formatTable`
 * - `output.ts` — JSON/CSV/TSV export and sparkline graph rendering
 */
export { formatTable, clampWidth, gridColumns, thermalColor, capacityColor } from './render.js';
export { formatJson, formatCsv, formatTsv, formatGraphs } from './output.js';
export type { ThemeName, ThemeColors, VisibleItems, TableOptions } from './types.js';
export { THEMES } from './themes.js';