import type { SubAgentGroupable } from '@/entities/message/lib/subAgentGrouping';

/**
 * One entry in a message's tool timeline. Left open deliberately: the baseline
 * writes provider- and toolkit-specific members onto these objects and the
 * rendering layer reads them by name, so narrowing the shape here would drop
 * data the UI still needs.
 *
 * It lives in its own leaf module because three files need the type from
 * three directions: `chatStreamShared` (helpers over it), `chatStreamReasoning`
 * (synthesises a reasoning row as one), and `convertMessagesToChatHistory`
 * (persisted timelines) — and the last two import each other's FUNCTIONS, so
 * housing the type in either of them (or in `chatStreamShared`, which needs
 * `ChatMessage` back from the converter) closed an import cycle the layer
 * gate refuses.
 */
export interface ToolAction extends SubAgentGroupable {
  readonly id: string;
  readonly status: string;
  readonly toolMeta?: Record<string, unknown> | undefined;
  readonly [key: string]: unknown;
}
