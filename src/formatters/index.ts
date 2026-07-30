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
export { formatTable, clampWidth, gridColumns, thermalColor, capacityColor, getTabHitboxes, TAB_BAR_ROW, TAB_DEFS, panel, formatBytes, padVisible, visLen, fitVisible } from './render.js';
export { formatJson, formatCsv, formatTsv, formatGraphs, formatHtml, formatMarkdown } from './output.js';
export type { ThemeName, ThemeColors, VisibleItems, TableOptions, AnomalyAlert } from './types.js';
export { THEMES } from './themes.js';