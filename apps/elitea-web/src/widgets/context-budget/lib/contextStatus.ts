/**
 * lib/contextStatus.ts — the display logic of the context-budget panel.
 *
 * `useGetContextStatusQuery` (`entities/conversation/api/contextManagementApi.ts`)
 * types its response as an opaque `Record<string, unknown>` wire bag, so the
 * narrowing lives here rather than in the component: it is where the two
 * production quirks the panel has to honour are actually decidable, and it is
 * unit-testable without a DOM.
 *
 * Quirk 1 — `max_tokens === 0` renders as `-`, never as `0`. Zero is the
 * server's "context manager disabled for this conversation" signal
 * (`ContextBudgetStatsDisplay.jsx`'s own `if (maxTokens === 0)` branch), not a
 * budget of zero tokens.
 *
 * Quirk 2 — the utilization SCALE differs between the two backends. Old-app
 * `useContextUtilization.hooks.js` does `Math.round(utilization * 100)`, i.e.
 * it expects a 0..1 fraction; the Go handler that actually serves this route
 * today returns `currentTokens / maxContextTokens * 100`, i.e. already a
 * percentage (`services/elitea-main/internal/infra/db/repos/conversations.go`,
 * `GetContextAnalytics`). Multiplying the Go value by 100 would render 10000%.
 * Rather than guess the scale from the value, the percentage is derived from
 * the two token counts, which are unambiguous and are exactly what the Go
 * handler divides anyway.
 */

/** The digit-group separator: U+00A0, so a grouped count never line-wraps mid-number. */
const GROUP_SEPARATOR = '\u00a0';

/** `>= 100%` of the budget — matches old-app `CONTEXT_BUDGET.HIGH_UTILIZATION_THRESHOLD: 1`. */
const HIGH_UTILIZATION_PERCENTAGE = 100;

/** What the panel renders in place of `max_tokens` when the context manager is off. */
const NO_MAX_TOKENS_DISPLAY = '-';

/**
 * Digit grouping for token counts. Old app calls `Intl.NumberFormat('fr-FR')`,
 * whose separator character changed between ICU versions (U+00A0 -> U+202F),
 * which would make any assertion on the output version-dependent. This groups
 * explicitly with a non-breaking space instead: same visual result, stable
 * across runtimes.
 */
export function formatNumberWithSpaces(value: number): string {
  if (!Number.isFinite(value)) return '';
  const rounded = Math.round(value);
  const digits = Math.abs(rounded).toString().replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR);
  return rounded < 0 ? `-${digits}` : digits;
}

/** @public The narrowed, display-ready shape the panel renders. */
export interface ContextBudgetStats {
  readonly currentTokens: number;
  readonly maxTokens: number;
  /** `"12 000 / 128 000"`, or `"12 000 / -"` when `maxTokens` is 0. */
  readonly tokensDisplay: string;
  /** Whole percent, `0` when there is no budget to divide by. Not capped — the bar caps its own width. */
  readonly utilizationPercentage: number;
  readonly isHighUtilization: boolean;
  readonly messageGroups: number;
  readonly summariesGenerated: number;
  /** `context_summarization` -> `context summarization`. */
  readonly strategyName: string;
}

function readNumber(source: Record<string, unknown>, key: string): number {
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readAnalytics(wire: Record<string, unknown>): Record<string, unknown> {
  const analytics = wire['context_analytics'];
  return typeof analytics === 'object' && analytics !== null ? (analytics as Record<string, unknown>) : {};
}

function readStrategyName(wire: Record<string, unknown>): string {
  const name = wire['strategy_name'];
  return typeof name === 'string' ? name.replace(/_/g, ' ') : '';
}

/** Percentage of the budget used. `0` when there is no budget (quirk 2 above). */
export function deriveUtilizationPercentage(currentTokens: number, maxTokens: number): number {
  if (maxTokens <= 0) return 0;
  return Math.round((currentTokens / maxTokens) * 100);
}

export function formatTokensDisplay(currentTokens: number, maxTokens: number): string {
  const max = maxTokens === 0 ? NO_MAX_TOKENS_DISPLAY : formatNumberWithSpaces(maxTokens);
  return `${formatNumberWithSpaces(currentTokens)} / ${max}`;
}

/** Narrows the wire bag. Returns `undefined` for a missing/non-object response so the caller renders nothing. */
export function toContextBudgetStats(wire: unknown): ContextBudgetStats | undefined {
  if (typeof wire !== 'object' || wire === null) return undefined;
  const source = wire as Record<string, unknown>;

  const currentTokens = readNumber(source, 'current_tokens');
  const maxTokens = readNumber(source, 'max_tokens');
  const utilizationPercentage = deriveUtilizationPercentage(currentTokens, maxTokens);

  return {
    currentTokens,
    maxTokens,
    tokensDisplay: formatTokensDisplay(currentTokens, maxTokens),
    utilizationPercentage,
    isHighUtilization: utilizationPercentage >= HIGH_UTILIZATION_PERCENTAGE,
    messageGroups: readNumber(source, 'message_groups_in_context'),
    summariesGenerated: readNumber(readAnalytics(source), 'summaries_generated'),
    strategyName: readStrategyName(source),
  };
}
