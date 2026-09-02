/**
 * One provider invocation poll, as every facade returns it.
 *
 * The SPI (conformance/provider/spi/contract.json) is the same for every
 * sub-application: a status, read-once `custom_events`, and on the terminal
 * poll a `result` string with an error category and type. Both DeepWiki
 * features used to spell this envelope out for themselves; this is the one
 * spelling (ADR-0023 decision 4).
 *
 * `Stopped` is deliberately in the status list although the generated
 * client's enum lacks it: the facade answers it after a cancel, and both
 * consumers branch on it.
 */
export interface InvocationPoll {
  readonly invocation_id?: string;
  /** Started | InProgress | Completed | Error | Stopped */
  readonly status?: string;
  readonly custom_events?: readonly { readonly data?: { readonly message?: unknown } }[];
  readonly result?: string;
  readonly message?: string;
  readonly error_category?: string;
  readonly error_type?: string;
}

/** A poll whose status means the invocation is over. */
export function isTerminalPoll(poll: InvocationPoll | undefined): boolean {
  const status = poll?.status;
  return status !== undefined && status !== 'Started' && status !== 'InProgress';
}

/**
 * The thinking messages one poll carried, in order, with the empty ones
 * dropped. An event with no message carries nothing to show; emitting it
 * would add a "Processing..." card per empty event, which is what the
 * reducers fall back to for a message they cannot read. The events are
 * read-once on the provider side — a second poll never repeats them — so
 * the caller must consume what this returns, not discard it.
 */
export function drainEventMessages(poll: InvocationPoll | undefined): readonly unknown[] {
  const messages: unknown[] = [];
  for (const event of poll?.custom_events ?? []) {
    const message = event.data?.message;
    if (message === undefined || message === null || message === '') continue;
    messages.push(message);
  }
  return messages;
}

/** How a finished invocation ended, read from its terminal poll. */
type TerminalOutcome =
  | { readonly kind: 'completed'; readonly status: string; readonly result: string }
  | {
      readonly kind: 'failed';
      readonly status: string;
      readonly message: string;
      readonly errorCategory: string | undefined;
      readonly errorType: string | undefined;
    };

/**
 * `Completed` carries its result UNPARSED — the result is a JSON string
 * whose shapes only the consumer knows. `Error` and `Stopped` carry the
 * provider's message, or the caller's fallback when there is none. A poll
 * that is still running, or none at all, has no outcome.
 */
export function terminalOutcome(
  poll: InvocationPoll | undefined,
  fallbackMessage: string,
): TerminalOutcome | null {
  if (!poll?.status) return null;
  if (poll.status === 'Completed') {
    return { kind: 'completed', status: poll.status, result: poll.result ?? '' };
  }
  if (poll.status === 'Error' || poll.status === 'Stopped') {
    return {
      kind: 'failed',
      status: poll.status,
      message: poll.result ?? poll.message ?? fallbackMessage,
      errorCategory: poll.error_category,
      errorType: poll.error_type,
    };
  }
  return null;
}
