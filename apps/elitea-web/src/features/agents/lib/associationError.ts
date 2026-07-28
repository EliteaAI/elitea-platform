import { buildErrorMessage } from '@/shared/lib/http-error';

/**
 * Ported from `apps/elitea-ui/src/hooks/application/useAgentPipelineAssociation.jsx:32-87`
 * (`mapAssociationError`) — Wave-2 unit A1e (`agents`/toolkit-association).
 * Pure, byte-parity of the message-selection logic; the only deviation from
 * the baseline is `buildErrorMessage`'s own already-disclosed `unknown`
 * return type (`shared/lib/http-error.ts`) instead of the baseline's
 * assumed-`string`, safely stringified (`describeRawError` below, same
 * technique `features/mcps/model/useMcpAuthCheck.ts`'s own `describeContent`
 * helper already established for this exact "an arbitrary payload needs a
 * one-line description, never `[object Object]`" situation) exactly where
 * the baseline concatenated it into a template literal.
 *
 * Maps a backend sub-agent validation error (issue #5680 cycle / leaf-rule
 * rejections and others) to a clear, actionable toast message. This is the
 * SINGLE source of truth for phrasing these errors — every flow that
 * binds/switches an agent-or-pipeline tool (add flow, version switch,
 * AI-generate) must route through here so the user never sees a raw backend
 * string or bare IDs.
 *
 * Split into one function per matched pattern (circular/sub-agent/bind-
 * itself) purely to stay under the §3.5 cyclomatic-complexity budget (12) —
 * the single-function baseline shape had a complexity of 22. Behaviour is
 * unchanged; each helper is the same `isSwitch`/`isStatus` 3-way branch the
 * monolithic version had inline.
 */

export type AssociationAction = 'add' | 'switch' | 'status';
export type AssociationEntityLabel = 'agent' | 'pipeline';

export interface MapAssociationErrorOptions {
  /**
   * `'add'` (bind a new tool), `'switch'` (change an existing tool's
   * version), or `'status'` (an already-attached tool whose sub-agent state
   * has since drifted into an invalid config — shown on the tool card, not
   * as an action rejection). Controls the verb and the actionable suffix.
   * @default 'add'
   */
  readonly action?: AssociationAction;
  /** Human-readable target version (switch action only), e.g. "base – 06.07.2026", so the message names the exact version being rejected. */
  readonly versionLabel?: string;
  /** Noun for the rejected entity. @default 'agent' */
  readonly entityLabel?: AssociationEntityLabel;
}

/** Safe stringification of an arbitrary raw error — `String(x)` on a non-primitive `x` degrades to `"[object Object]"`, which the baseline's implicit template-literal coercion would have done too, but explicitly here rather than silently. */
function describeRawError(rawError: unknown): string {
  if (typeof rawError === 'string') return rawError;
  const built = buildErrorMessage(rawError);
  if (typeof built === 'string') return built;
  if (built === undefined || built === null) return '';
  try {
    return JSON.stringify(built);
  } catch {
    return '';
  }
}

function targetPhrase(entityName: string, action: AssociationAction, versionLabel: string | undefined): string {
  if (action === 'switch') return `switch "${entityName}"${versionLabel ? ` to version ${versionLabel}` : ''}`;
  if (action === 'status') return `use "${entityName}"`;
  return `add "${entityName}"`;
}

function circularMessage(target: string, action: AssociationAction, entityLabel: AssociationEntityLabel): string {
  if (action === 'switch') {
    return (
      `Cannot ${target}: this ${entityLabel} version is already in the chain and would create a ` +
      `circular reference. Choose a different version or remove the circular reference first.`
    );
  }
  if (action === 'status') {
    return (
      `Cannot ${target}: this ${entityLabel} is now part of a circular reference in the agent ` +
      `chain. Point it to a version that isn't already in the chain, or remove it.`
    );
  }
  return `Cannot ${target}: this would create a circular agent reference. Remove the circular dependency first.`;
}

function subAgentMessage(target: string, action: AssociationAction): string {
  if (action === 'switch') {
    return (
      `Cannot ${target}: that version uses other agents and can only run directly as a chat ` +
      `participant, not as a sub-agent tool. Choose a leaf version instead.`
    );
  }
  if (action === 'status') {
    return (
      `Cannot ${target}: it now uses other agents, so it can only run directly as a chat ` +
      `participant, not as a sub-agent tool. Replace it with a leaf version.`
    );
  }
  // Add path binds the child's DEFAULT version, so the actionable fix is to make a leaf version
  // (one that doesn't itself use other agents) the default — then it can be attached here.
  return (
    `Cannot ${target}: it uses other agents and can only be run directly as a chat participant, ` +
    `not added as a tool. Tip: make a version of it without sub-agents its default, then add it.`
  );
}

function bindItselfMessage(target: string, action: AssociationAction, entityLabel: AssociationEntityLabel): string {
  if (action === 'switch') return `Cannot ${target}: a version cannot reference itself.`;
  if (action === 'status') return `Cannot ${target}: a ${entityLabel} cannot reference itself.`;
  return `Cannot ${target} to itself.`;
}

export function mapAssociationError(rawError: unknown, entityName: string, opts: MapAssociationErrorOptions = {}): string {
  const { action = 'add', versionLabel, entityLabel = 'agent' } = opts;
  const message = describeRawError(rawError);
  const lower = message.toLowerCase();
  const target = targetPhrase(entityName, action, versionLabel);

  if (lower.includes('circular') || lower.includes('cycle')) {
    return circularMessage(target, action, entityLabel);
  }
  if (lower.includes('uses other agents') || lower.includes('cannot be nested') || lower.includes('sub-agent')) {
    return subAgentMessage(target, action);
  }
  if (lower.includes('bind') && lower.includes('itself')) {
    return bindItselfMessage(target, action, entityLabel);
  }
  return message;
}
