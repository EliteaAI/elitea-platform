import type { Canvas, CanvasEditorPresence } from '../model/types';

/**
 * Wire shape of a `chat_canvas_sync`/`chat_canvas_detail` payload's `content`
 * field (apps/elitea-ui/src/hooks/chat/useCanvasSocket.js:52-60,108-116
 * both unwrap `message.content` before handing it to the consumer) merged
 * with the editors-change payload fields
 * (apps/elitea-ui/src/pages/NewChat/CanvasEditor.jsx:290-292:
 * `{editors, canvas_uuid, message_group_uuid}`, `editor.user_name`).
 */
export interface CanvasWire {
  readonly uuid: string;
  readonly name?: string;
  readonly canvas_type?: string;
  readonly code_language?: string;
  readonly canvas_content?: string;
  readonly editors?: readonly { readonly user_name: string }[];
  readonly message_group_uuid?: string;
}

function normaliseEditors(editors: CanvasWire['editors']): CanvasEditorPresence[] | undefined {
  return editors?.map((editor) => ({ userName: editor.user_name }));
}

/** snake_case wire shape -> camelCase `Canvas` domain type. */
export function normaliseCanvas(wire: CanvasWire): Canvas {
  const editors = normaliseEditors(wire.editors);
  return {
    uuid: wire.uuid,
    ...(wire.name !== undefined ? { name: wire.name } : {}),
    ...(wire.canvas_type !== undefined ? { canvasType: wire.canvas_type } : {}),
    ...(wire.code_language !== undefined ? { codeLanguage: wire.code_language } : {}),
    ...(wire.canvas_content !== undefined ? { content: wire.canvas_content } : {}),
    ...(editors !== undefined ? { editors } : {}),
    ...(wire.message_group_uuid !== undefined ? { messageGroupUuid: wire.message_group_uuid } : {}),
  };
}

/**
 * apps/elitea-ui/src/hooks/chat/useCanvasSocket.js:58-60,110-112 — both the
 * sync and detail handlers unwrap `message.content` before use.
 */
export function unwrapCanvasSyncPayload(message: { readonly content: CanvasWire }): Canvas {
  return normaliseCanvas(message.content);
}
