/**
 * pyre live dashboard module.
 *
 * Provides the interactive live monitoring mode with
 * keyboard-driven customization, process filtering,
 * snapshot export, and continuous CSV logging.
 *
 * The module is organised into five sub-files:
 * - `types.ts`   — type definitions
 * - `state.ts`   — shared mutable session state
 * - `render.ts`  — screen rendering and alert checking
 * - `input.ts`   — keypress handling and session lifecycle
 * - `export.ts`  — snapshot export and CSV logging
 */
export { startLive, stopLive } from './input.js';
export type { LiveOptions } from './types.js';