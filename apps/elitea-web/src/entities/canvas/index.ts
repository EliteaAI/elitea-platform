/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 */
export type { Canvas, CanvasEditorPresence } from './model/types';
export { isCanvasReadOnlyForUser, isCodeCanvas, realCanvasEditors } from './model/selectors';
export type { CanvasWire } from './lib/normalise';
export { normaliseCanvas, unwrapCanvasSyncPayload } from './lib/normalise';
