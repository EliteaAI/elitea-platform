/**
 * Public API — spec §3.3: named exports only, curated (§3.5 budget: ≤20).
 */
export type { Canvas, CanvasEditorPresence } from './model/types';
export { isCanvasReadOnlyForUser, isCodeCanvas, realCanvasEditors } from './model/selectors';
export type { CanvasWire } from './lib/normalise';
export { normaliseCanvas, unwrapCanvasSyncPayload } from './lib/normalise';

/**
 * Param/result interfaces for the hooks below (`CreateCanvasParams`,
 * `UploadAttachmentsParams`, etc.) are DELIBERATELY not re-exported here —
 * §3.5's ≤20-export budget was already at its ceiling once these 12 hooks
 * were added, and every one of them is called as `mutate(params)`/
 * `useXQuery(params)`, so TS infers/checks `params` against the hook's own
 * signature without a caller needing the interface name in scope. A
 * cross-layer consumer that genuinely needs one of these interfaces named
 * (rather than inferred) is a real signal this barrel is under-provisioned —
 * revisit the budget rather than deep-importing `./api/canvasApi` (R-L3).
 */
export {
  useCanvasDetailsQuery,
  useCreateCanvasMutation,
  useEditCanvasMutation,
  useSetAttachmentStorageMutation,
  useUploadAttachmentsMutation,
  useRemoveAttachmentsMutation,
} from './api/canvasApi';

export {
  useCanvasEditSocket,
  useCanvasSyncSocket,
  useCanvasErrorSocket,
  useCanvasDetailSocket,
  useCanvasContentChangeSocket,
  useCanvasPresenceSocket,
} from './api/canvasSocket';
