import type { Canvas, CanvasEditorPresence } from './types';

/**
 * apps/elitea-ui/src/common/constants.js:1026-1027 — synthetic usernames
 * the server attaches for its own automation, never a real collaborator.
 */
const CANVAS_ADMIN_USER = 'admin@centry.user';
const CANVAS_SYSTEM_USER = 'system@centry.user';

/**
 * apps/elitea-ui/src/pages/NewChat/CanvasEditor.jsx:298-301 — the editors
 * list with the two synthetic system usernames filtered out.
 */
export function realCanvasEditors(editors: readonly CanvasEditorPresence[]): CanvasEditorPresence[] {
  return editors.filter((editor) => editor.userName !== CANVAS_ADMIN_USER && editor.userName !== CANVAS_SYSTEM_USER);
}

/**
 * apps/elitea-ui/src/pages/NewChat/CanvasEditor.jsx:290-312
 * `onCanvasEditorsChange`, ported as a pure function: when NO real (non-
 * synthetic) editor is present, the canvas is editable by anyone
 * (`readOnly = false`); once at least one real editor is present, it is
 * read-only for everyone EXCEPT a user whose name is among the real
 * editors.
 */
export function isCanvasReadOnlyForUser(editors: readonly CanvasEditorPresence[], userName: string): boolean {
  const real = realCanvasEditors(editors);
  if (real.length === 0) return false;
  return !real.some((editor) => editor.userName === userName);
}

export function isCodeCanvas(canvas: Canvas): boolean {
  return canvas.canvasType === 'code';
}
