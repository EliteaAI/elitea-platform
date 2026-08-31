/**
 * lib/mermaidQuickFix.ts — the pure half of the canvas mermaid quick-fix
 * (Canvas slice 2b). Ported from `apps/elitea-ui/src/components/
 * MermaidDiagramOutput/mermaidQuickFixModel.helpers.js` and
 * `.../mermaidQuickFixPrompt.js`, plus the two `extract*` closures that lived
 * inline in `apps/elitea-ui/src/[fsd]/features/chat/ui/editors/
 * CanvasEditor.jsx` (baseline lines 149-247).
 *
 * No React, no network. `../model/useMermaidQuickFix.ts` owns the reads.
 */

/** The model the quick-fix call should run on, and why it was picked. */
export interface MermaidQuickFixModelInfo {
  readonly modelName: string;
  readonly modelProjectId: number;
  readonly tooltip: string;
  /** True when the low-tier default was absent and something else was substituted. */
  readonly isFallback: boolean;
}

/** The subset of `GET /configurations/models/{projectId}` this reads. */
export interface MermaidQuickFixModelsWire {
  readonly low_tier_default_model_name?: string | undefined;
  readonly low_tier_default_model_project_id?: string | number | undefined;
  readonly default_model_name?: string | undefined;
  readonly default_model_project_id?: string | number | undefined;
  readonly items?: readonly { readonly name?: string; readonly project_id?: string | number }[] | undefined;
}

function toModelInfo(
  name: string | undefined,
  projectId: string | number | undefined,
  label: string,
  isFallback: boolean,
): MermaidQuickFixModelInfo | null {
  if (name === undefined || name === '' || projectId === undefined || projectId === '') return null;
  const numericProjectId = Number(projectId);
  if (!Number.isFinite(numericProjectId)) return null;
  return { modelName: String(name), modelProjectId: numericProjectId, tooltip: `Quick Fix: ${name} (${label})`, isFallback };
}

/**
 * Picks the quick-fix model: the project's low-tier default
 * (`internal/application/configurations/models.go:81-82`), else the plain
 * default, else the first model in the list. `null` means "no model is
 * available" — which is what gates the button off, not a toast.
 */
export function getMermaidQuickFixModelInfo(
  models: MermaidQuickFixModelsWire | undefined | null,
): MermaidQuickFixModelInfo | null {
  if (!models) return null;

  const first = models.items?.[0];
  return (
    toModelInfo(models.low_tier_default_model_name, models.low_tier_default_model_project_id, 'low-tier', false) ??
    toModelInfo(models.default_model_name, models.default_model_project_id, 'default fallback', true) ??
    toModelInfo(first?.name, first?.project_id, 'fallback', true)
  );
}

/** Appends the failing diagram and its error to the authored service prompt. */
export function buildMermaidQuickFixPrompt({
  basePrompt,
  error,
  code,
}: {
  readonly basePrompt: string;
  readonly error: string;
  readonly code: string;
}): string {
  return `${basePrompt.trim()}\n\n---\n\nMermaid error:\n${error}\n\nMermaid code:\n${code}\n`;
}

/** Unwraps a ```mermaid fence (or any fence) from the model's reply. */
export function extractMermaidCode(text: string | undefined | null): string {
  if (text === undefined || text === null) return '';
  const raw = String(text).trim();

  const fencedMermaid = /```mermaid\s*([\s\S]*?)```/i.exec(raw);
  if (fencedMermaid?.[1] !== undefined) return fencedMermaid[1].trim();

  const fencedAny = /```\s*([\s\S]*?)```/.exec(raw);
  if (fencedAny?.[1] !== undefined) return fencedAny[1].trim();

  return raw;
}

function coerceContentToText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        const record = part as { text?: unknown; content?: unknown } | null;
        const text = record?.text ?? record?.content;
        return typeof text === 'string' ? text : '';
      })
      .join('');
  }
  return '';
}

function extractLastChatHistoryText(chatHistory: unknown): string {
  if (!Array.isArray(chatHistory) || chatHistory.length === 0) return '';

  for (let index = chatHistory.length - 1; index >= 0; index -= 1) {
    const message = chatHistory[index] as { role?: string; type?: string; content?: unknown } | null;
    const role = message?.role ?? message?.type;
    const text = coerceContentToText(message?.content ?? message);
    if (text === '') continue;
    if (role === 'assistant' || role === 'ai') return text;
  }

  const fallback = chatHistory[chatHistory.length - 1] as { content?: unknown } | null;
  return coerceContentToText(fallback?.content ?? fallback);
}

/** Digs the assistant's text out of `predict_llm`'s several possible response shapes. */
export function extractPredictText(response: unknown): string {
  const record = response as { result?: unknown } | null;
  const result = record?.result ?? response;

  if (typeof result === 'string') return result;
  if (result === null || result === undefined || typeof result !== 'object') return '';

  const shaped = result as {
    elitea_response?: unknown;
    output?: unknown;
    chat_history?: unknown;
    messages?: unknown;
  };

  if (typeof shaped.elitea_response === 'string') return shaped.elitea_response;
  if (typeof shaped.output === 'string') return shaped.output;

  const chatHistoryText = extractLastChatHistoryText(shaped.chat_history);
  if (chatHistoryText !== '') return chatHistoryText;

  if (Array.isArray(shaped.messages) && shaped.messages.length > 0) {
    const last = shaped.messages[shaped.messages.length - 1] as { content?: unknown } | string;
    if (typeof last === 'string') return last;
    const content = coerceContentToText(last?.content);
    if (content !== '') return content;
  }

  try {
    return JSON.stringify(result);
  } catch {
    // A structure JSON.stringify cannot serialise (a cycle) is not text the
    // user wants either; an empty answer is refused by the caller as
    // "Quick Fix did not return Mermaid code", which is the honest outcome.
    return '';
  }
}
