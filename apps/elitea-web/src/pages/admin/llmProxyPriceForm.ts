/**
 * Pure form logic for the LLM Proxy price dialog.
 *
 * Split out of the dialog so the number handling — which is where the costing
 * bugs live — is testable without rendering anything, and so the dialog stays
 * under the complexity gate. Same split as `./adminMcpServerForm`.
 *
 * ## Prices are strings in the form and numbers on the wire
 *
 * The draft holds strings because that is what a text input holds, and because
 * the empty string is the only way to express "no rate" in one. `toPrice`
 * performs the one conversion, and it is the only place a price becomes a
 * number.
 */
import { t } from '@/shared/i18n';

import type { LlmModelPriceDraft, LlmModelRow, UnpricedLlmModel } from './api/adminLlmProxyApi';

/**
 * The six price fields, keyed exactly as the server names them.
 *
 * Six, not nine. The table also holds `cache_creation_input_token_cost`,
 * `cache_read_input_token_cost` and `input_cost_per_1m_tokens_above_128k`, and
 * the gateway's cost path reads NONE of them — its catalogue statement selects
 * only these six. Offering the other three would be a control whose value
 * changes no bill, and would let an operator satisfy the "at least one price"
 * rule with a column nothing consults, pinning the row off the price sync while
 * it keeps billing at the fabricated default.
 */
export const PRICE_FIELD_KEYS = [
  'input_cost_per_1m_tokens',
  'output_cost_per_1m_tokens',
  'input_cost_per_1m_seconds',
  'output_cost_per_1m_seconds',
  'input_cost_per_1m_characters',
  'output_cost_per_1m_characters',
] as const;

export type PriceFieldKey = (typeof PRICE_FIELD_KEYS)[number];

/** The dialog's working state: identity plus one string per price field. */
export type PriceDraft = {
  provider: string;
  model_name: string;
} & Record<PriceFieldKey, string>;

/** An empty draft — every price blank, meaning "no rate". */
export const emptyPriceDraft: PriceDraft = {
  provider: '',
  model_name: '',
  input_cost_per_1m_tokens: '',
  output_cost_per_1m_tokens: '',
  input_cost_per_1m_seconds: '',
  output_cost_per_1m_seconds: '',
  input_cost_per_1m_characters: '',
  output_cost_per_1m_characters: '',
};

/**
 * The field groups the dialog renders, in the order it renders them.
 *
 * Labels are thunks rather than strings so `t` is called at render time. A
 * module-level `t(...)` would be evaluated once at import, before the bundle's
 * translations are in place, and would freeze the English fallback.
 */
export const priceFieldGroups: readonly {
  readonly id: string;
  readonly label: () => string;
  readonly fields: readonly {
    readonly key: PriceFieldKey;
    readonly label: () => string;
  }[];
}[] = [
  {
    id: 'tokens',
    label: () => t('pages.admin.llmProxy.price.group.tokens', 'Token pricing (USD per 1M tokens)'),
    fields: [
      {
        key: 'input_cost_per_1m_tokens',
        label: () => t('pages.admin.llmProxy.price.field.input', 'Input / 1M tokens'),
      },
      {
        key: 'output_cost_per_1m_tokens',
        label: () => t('pages.admin.llmProxy.price.field.output', 'Output / 1M tokens'),
      },
    ],
  },
  {
    id: 'audio',
    label: () =>
      t(
        'pages.admin.llmProxy.price.group.audio',
        'Audio pricing (USD per 1M seconds / 1M characters)',
      ),
    fields: [
      {
        key: 'input_cost_per_1m_seconds',
        label: () => t('pages.admin.llmProxy.price.field.inputSeconds', 'Input / 1M seconds'),
      },
      {
        key: 'output_cost_per_1m_seconds',
        label: () => t('pages.admin.llmProxy.price.field.outputSeconds', 'Output / 1M seconds'),
      },
      {
        key: 'input_cost_per_1m_characters',
        label: () => t('pages.admin.llmProxy.price.field.inputChars', 'Input / 1M characters'),
      },
      {
        key: 'output_cost_per_1m_characters',
        label: () => t('pages.admin.llmProxy.price.field.outputChars', 'Output / 1M characters'),
      },
    ],
  },
];

/** Renders a stored price back into the form. `null` becomes blank, `0` does not. */
function fromPrice(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

/**
 * Converts one form field to what the wire carries.
 *
 * Blank and whitespace become `null` — "no rate". A value that is not a number
 * ALSO becomes null rather than `NaN`: `JSON.stringify(NaN)` is the literal
 * `null` anyway, so returning NaN here would produce the same request while
 * making the intent unreadable at the call site.
 */
function toPrice(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Seeds the dialog from whichever subject it opened on. */
export function priceDraftFromRow(
  row: LlmModelRow | undefined,
  unpriced: UnpricedLlmModel | undefined,
): PriceDraft {
  if (row !== undefined) {
    return {
      provider: row.provider,
      model_name: row.model_name,
      input_cost_per_1m_tokens: fromPrice(row.input_cost_per_1m_tokens),
      output_cost_per_1m_tokens: fromPrice(row.output_cost_per_1m_tokens),
      input_cost_per_1m_seconds: fromPrice(row.input_cost_per_1m_seconds),
      output_cost_per_1m_seconds: fromPrice(row.output_cost_per_1m_seconds),
      input_cost_per_1m_characters: fromPrice(row.input_cost_per_1m_characters),
      output_cost_per_1m_characters: fromPrice(row.output_cost_per_1m_characters),
    };
  }
  if (unpriced !== undefined) {
    // Identity only. The pair was called but never priced, so there is nothing
    // to pre-fill — and pre-filling a plausible price would be inventing one.
    return {
      ...emptyPriceDraft,
      provider: unpriced.provider,
      model_name: unpriced.model_name,
    };
  }
  return emptyPriceDraft;
}

/**
 * Converts the draft to the request body.
 *
 * Every price is present, including the null ones. Omitting a blank field would
 * leave the previously stored value, making it impossible to clear a rate that
 * should not exist — see the dialog's header.
 */
export function priceDraftToWrite(draft: PriceDraft): LlmModelPriceDraft {
  return {
    provider: draft.provider.trim(),
    model_name: draft.model_name.trim(),
    input_cost_per_1m_tokens: toPrice(draft.input_cost_per_1m_tokens),
    output_cost_per_1m_tokens: toPrice(draft.output_cost_per_1m_tokens),
    input_cost_per_1m_seconds: toPrice(draft.input_cost_per_1m_seconds),
    output_cost_per_1m_seconds: toPrice(draft.output_cost_per_1m_seconds),
    input_cost_per_1m_characters: toPrice(draft.input_cost_per_1m_characters),
    output_cost_per_1m_characters: toPrice(draft.output_cost_per_1m_characters),
  };
}

/** Whether a draft asserts at least one price — the server refuses one that does not. */
export function draftHasAnyPrice(draft: PriceDraft): boolean {
  return PRICE_FIELD_KEYS.some((key) => toPrice(draft[key]) !== null);
}
