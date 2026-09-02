/**
 * Decide whether a frame's payload is really an error, and what to say.
 *
 * PORTED BUG-FOR-BUG from apps/deepwiki-ui/src/DeepWikiApp.jsx:1683-1770 and
 * recorded as a WAIVED parity item. It is sixty lines of sniffing a value that
 * may be a string, a JSON string, or an object, for six different shapes of
 * failure — because the provider reports errors in six different shapes and
 * this screen is the last place they can be turned into something a user can
 * read.
 *
 * IT IS NOT "CLEANED UP", and the substring matching is the reason. Rules like
 * `content.includes('slots taken')` and `contentLower.includes('runtimeerror')`
 * are matching prose that some upstream produces today. Every one of them is
 * load-bearing for a real failure a user would otherwise see as a silent
 * success, and NONE of them can be verified from this repository — the strings
 * come from the engine and from the models it calls. Tightening one is a bet
 * that a message never changes shape; the port takes no such bet.
 *
 * THE OUTER try/catch RETURNS "not an error". That is the legacy behaviour and
 * it is preserved deliberately: a payload this function cannot understand is
 * one it has no grounds to call a failure, and guessing would turn a working
 * generation into a reported error.
 */

/** What the sniffer concluded. */
export interface ParsedAgentError {
  readonly isError: boolean;
  readonly message: string | null;
}

const NOT_AN_ERROR: ParsedAgentError = { isError: false, message: null };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}


/**
 * The service-busy markers.
 *
 * Four spellings of one condition, because four different layers report it
 * differently: a bracketed marker the engine emits, the phrase in prose, the
 * counts sentence, and the counts phrase alone. Extracted from the main
 * function only to keep it under the complexity limit — no rule changed.
 */
function isServiceBusyMarker(contentStr: string | null): boolean {
  if (typeof contentStr !== 'string') return false;
  const lower = contentStr.toLowerCase();
  return (
    contentStr.includes('[SERVICE_BUSY]') ||
    lower.includes('service busy') ||
    contentStr.includes('Max parallel wiki generations reached') ||
    contentStr.includes('slots taken')
  );
}

/**
 * Every way a payload announces failure.
 *
 * The substring rules match prose some upstream produces. None can be verified
 * from this repository — the strings come from the engine and from the models
 * it calls — so each is preserved exactly as the legacy code had it.
 */
function looksLikeFailure(
  contentStr: string | null,
  status: unknown,
  errorCategory: unknown,
  busy: boolean,
): boolean {
  const text = typeof contentStr === 'string' ? contentStr : '';
  const lower = text.toLowerCase();

  const inferenceFailed =
    errorCategory === 'inference_failed' || text.includes('inference_failed');
  const generationFailed =
    text.includes('Generate_wiki failed') ||
    text.includes('failed for model') ||
    lower.includes('runtimeerror') ||
    lower.includes('generation failed');

  return (
    status === 'Error' ||
    errorCategory === 'service_busy' ||
    busy ||
    inferenceFailed ||
    generationFailed
  );
}

/**
 * Normalise a payload into the pair the rules run against.
 *
 * A value may arrive as an object, as a plain string, or as a JSON STRING. When
 * it parses, the parsed object wins AND the string is replaced by its message —
 * but the string is kept, because the substring rules run against it.
 */
function normalise(maybeContent: unknown): {
  contentObj: Record<string, unknown> | null;
  contentStr: string | null;
} {
  let contentObj = asRecord(maybeContent);
  let contentStr = typeof maybeContent === 'string' ? maybeContent : null;

  if (!contentStr || !(contentStr.trim().startsWith('{') || contentStr.trim().startsWith('['))) {
    return { contentObj, contentStr };
  }
  try {
    const record = asRecord(JSON.parse(contentStr));
    if (record) {
      contentObj = record;
      const message = record.message ?? record.error;
      contentStr = typeof message === 'string' ? message : contentStr;
    }
  } catch {
    // Not valid JSON, keep as string.
  }
  return { contentObj, contentStr };
}

/**
 * The slots message, built rather than quoted.
 *
 * It is the one failure a user can act on: it names how many are in use and
 * tells them to wait. BOTH counts must be numbers — a partial payload returns
 * null and falls through to the generic message rather than rendering
 * "3/undefined slots taken".
 */
function slotsMessage(contentObj: Record<string, unknown> | null): string | null {
  const activeWorkers = contentObj?.active_workers;
  const maxWorkers = contentObj?.max_workers;
  if (typeof activeWorkers !== 'number' || typeof maxWorkers !== 'number') return null;
  return (
    `Max parallel wiki generations reached: ${String(activeWorkers)}/${String(maxWorkers)} ` +
    `slots taken. Please wait for a running generation to finish and try again.`
  );
}

/**
 * The human-readable text inside a Syngen-style payload.
 *
 * It puts the message in a JSON array in `result`. Digging it out is the
 * difference between showing a user their failure and showing them a
 * serialised envelope.
 */
function syngenMessage(contentObj: Record<string, unknown> | null): string | null {
  const rawResult = contentObj?.result;
  if (typeof rawResult !== 'string' || !rawResult.trim().startsWith('[')) return null;
  try {
    const objs: unknown = JSON.parse(rawResult);
    if (!Array.isArray(objs)) return null;
    const firstMsg: unknown = objs.find((o: unknown) => {
      const record = asRecord(o);
      return record?.object_type === 'message' && typeof record.data === 'string';
    });
    const data = asRecord(firstMsg)?.data;
    return typeof data === 'string' && data ? data : null;
  } catch {
    return null;
  }
}


/**
 * The best message available for a failure, in the legacy order of preference.
 *
 * Slots first, because it is the only one a user can act on. Then the Syngen
 * envelope, then the payload's own `error` or `message`, then whatever string
 * we have, then a generic sentence. Falling through to the generic one is not a
 * defeat: it means the payload said it failed and did not say why, and inventing
 * a reason would be worse than saying so.
 */
function failureMessage(
  contentObj: Record<string, unknown> | null,
  contentStr: string | null,
  errorCategory: unknown,
  busy: boolean,
): string {
  if (errorCategory === 'service_busy' || busy) {
    const slots = slotsMessage(contentObj);
    if (slots) return slots;
  }
  const syngen = syngenMessage(contentObj);
  if (syngen) return syngen;

  const error = contentObj?.error;
  const message = contentObj?.message;
  return (
    (typeof error === 'string' && error) ||
    (typeof message === 'string' && message) ||
    contentStr ||
    'Wiki generation failed'
  );
}

export function parseAgentResponseForError(
  maybeContent: unknown,
  maybeMetadata?: Record<string, unknown>,
): ParsedAgentError {
  try {
    const { contentObj, contentStr } = normalise(maybeContent);

    const status = contentObj?.status ?? maybeMetadata?.status;
    const errorCategory = contentObj?.error_category ?? maybeMetadata?.error_category;
    const busy = isServiceBusyMarker(contentStr);

    if (!looksLikeFailure(contentStr, status, errorCategory, busy)) return NOT_AN_ERROR;

    return { isError: true, message: failureMessage(contentObj, contentStr, errorCategory, busy) };
  } catch {
    // A payload this function cannot understand is one it has no grounds to
    // call a failure. Guessing would turn a working generation into a reported
    // error.
    return NOT_AN_ERROR;
  }
}
