import type { ToolkitChatMessage } from '../../lib/hooks/useToolkitChat.types';

/**
 * Pure helpers for `TestTools.tsx` (Wave-2 unit A4f) — split out purely to
 * keep that file under the §3.5 400-line-per-file/12-complexity budgets
 * (see its own module doc comment for the full citation list).
 *
 * `getMessageItemContent`/`getMessageContentForCopy` are a byte-for-byte
 * port of `IndexChat.tsx`'s own same-named helpers (unit A4a, same slice,
 * genuinely identical need — `TestTools.tsx`'s `chatHistory` is the same
 * `ToolkitChatMessage` union `IndexChat.tsx`'s `ChatDisplayMessage` covers).
 * `typeof content === 'string' ? content : ''` (not `String(content ?? '')`)
 * avoids `typescript/no-base-to-string` firing on a genuinely-`unknown`
 * `content` field that could be a non-primitive object.
 */
function getMessageItemContent(item: unknown): string {
  if (!item || typeof item !== 'object' || !('content' in item)) return '';
  const content = (item as { content?: unknown }).content;
  return typeof content === 'string' ? content : '';
}

export function getMessageContentForCopy(message: ToolkitChatMessage | undefined): string {
  if (!message) return '';
  if ('exception' in message && message.exception) return JSON.stringify(message.exception);
  if ('messageItems' in message && message.messageItems?.length) {
    return message.messageItems.map(getMessageItemContent).filter(Boolean).join('\n');
  }
  return message.content ?? '';
}

interface DefaultableProperty {
  readonly default?: unknown;
  readonly type?: string;
  readonly anyOf?: readonly { readonly type?: string; readonly default?: unknown }[];
}

/** The `anyOf`-branch half of `resolveDefaultValue` — split out to stay under the §3.5 complexity budget. */
function resolveAnyOfDefault(property: DefaultableProperty): unknown {
  const arraySchema = property.anyOf?.find((schema) => schema.type === 'array');
  if (arraySchema && arraySchema.default !== undefined) return arraySchema.default;
  if (property.anyOf?.find((schema) => schema.type === 'null')) return null;
  return undefined;
}

/** The type-keyed-fallback half of `resolveDefaultValue` — split out to stay under the §3.5 complexity budget. */
function resolveTypeDefault(type: string | undefined): unknown {
  switch (type) {
    case 'object':
      return {};
    case 'array':
      return [];
    case 'boolean':
      return false;
    case 'string':
      return '';
    case 'number':
    case 'integer':
      return null;
    case undefined:
    default:
      return '';
  }
}

/**
 * Port of `TestTools.jsx`'s `initializeDefaultConfigValues`'s per-property
 * default-value resolution (baseline lines 119-155): explicit
 * `property.default`, else an `anyOf`-branch default/null, else a
 * type-keyed fallback.
 */
export function resolveDefaultValue(property: DefaultableProperty): unknown {
  const defaultValue = property.default;
  if (defaultValue !== undefined) return defaultValue;

  const anyOfDefault = resolveAnyOfDefault(property);
  if (anyOfDefault !== undefined) return anyOfDefault;

  return resolveTypeDefault(property.type);
}
