/**
 * apps/elitea-ui/src/[fsd]/features/chat/lib/helpers/subAgentGrouping.helpers.js:143-206
 * `collapseSubAgentInvocationKeys`, ported verbatim — a pure, dependency-free
 * algorithm per that file's own header comment, so it needs no cross-layer
 * import to live here. `convertToAIAnswer` (convertChatConversationMessages.js:254-263)
 * calls it on the freshly-built `toolActions[]` before returning. NOT ported:
 * `partitionActionsIntoBlocks`/`buildPcidAnchorMap`/`resolveExtraSubAgentKeys`/
 * `resolveSubAgentLiveness`/`inflightToolChipId` from the same file — those
 * back the LIVE-streaming accordion view (`ApplicationThinkView`), not the
 * persisted-reload path this slice normalises.
 *
 * Split into three small passes (mirroring the source's own "Pass 0/1/2"
 * comments) to stay under the repo's cyclomatic-complexity budget
 * (.oxlintrc.json "complexity": 12) — each pass is a direct, unmerged
 * transcription of its JS counterpart.
 */

/**
 * The subset of a tool-action draft the grouping algorithm reads/mutates.
 * `| undefined` widenings on the mutable fields mirror `ToolActionDraft`
 * (entities/message/lib/toolActions.ts) so a `ToolActionDraft[]` satisfies
 * this constraint under `exactOptionalPropertyTypes`.
 */
export interface SubAgentGroupable {
  readonly type: string;
  readonly name?: string;
  readonly original_name?: string | null;
  parent_agent_name?: string | null | undefined;
  parent_agent_call_id?: string | undefined;
  readonly isError?: boolean;
  readonly toolOutputs?: unknown;
}

export interface SubAgentGroupingOptions<A extends SubAgentGroupable> {
  readonly deriveName: (action: A) => string;
  readonly deriveRawKey: (action: A) => string;
  readonly isWrapperCompletion: (action: A, name: string) => boolean;
}

interface Epoch<A extends SubAgentGroupable> {
  actions: A[];
  anchor: string;
  closed: boolean;
  closingKey: string;
}

/** Pass 0 (lines 149-168): per-name concurrency detection. */
function findParallelNames<A extends SubAgentGroupable>(
  actions: readonly A[],
  deriveName: (action: A) => string,
  deriveRawKey: (action: A) => string,
): Set<string> {
  const parallelNames = new Set<string>();
  const lastKeyByName = new Map<string, string>();
  const seenKeysByName = new Map<string, Set<string>>();
  actions.forEach((action) => {
    const name = deriveName(action);
    if (!name) return;
    const raw = deriveRawKey(action);
    if (!raw) return;
    const seen = seenKeysByName.get(name) ?? new Set<string>();
    seenKeysByName.set(name, seen);
    const last = lastKeyByName.get(name);
    if (last !== undefined && raw !== last && seen.has(raw)) parallelNames.add(name);
    seen.add(raw);
    lastKeyByName.set(name, raw);
  });
  return parallelNames;
}

/** A closed epoch is stale once a genuinely new pcid shows up (source line 181). */
function isEpochStale<A extends SubAgentGroupable>(epoch: Epoch<A>, raw: string): boolean {
  return epoch.closed && raw !== '' && raw !== epoch.anchor && raw !== epoch.closingKey;
}

function appendToEpoch<A extends SubAgentGroupable>(
  epoch: Epoch<A>,
  action: A,
  raw: string,
  isWrapperCompletion: (action: A, name: string) => boolean,
  name: string,
): void {
  epoch.actions.push(action);
  if (!epoch.anchor && raw) epoch.anchor = raw;
  if (isWrapperCompletion(action, name)) {
    epoch.closed = true;
    epoch.closingKey = raw || epoch.closingKey;
  }
}

/** Pass 1 (lines 170-195): bucket sequential actions into completion epochs. */
function buildEpochs<A extends SubAgentGroupable>(
  actions: readonly A[],
  parallelNames: ReadonlySet<string>,
  opts: SubAgentGroupingOptions<A>,
): { epoch: Epoch<A>; name: string }[] {
  const epochByName = new Map<string, Epoch<A>>();
  const epochs: { epoch: Epoch<A>; name: string }[] = [];
  actions.forEach((action) => {
    const name = opts.deriveName(action);
    if (!name || parallelNames.has(name)) return;
    const raw = opts.deriveRawKey(action);
    const existing = epochByName.get(name);
    const epoch = existing && !isEpochStale(existing, raw) ? existing : { actions: [], anchor: '', closed: false, closingKey: '' };
    if (epoch !== existing) {
      epochByName.set(name, epoch);
      epochs.push({ epoch, name });
    }
    appendToEpoch(epoch, action, raw, opts.isWrapperCompletion, name);
  });
  return epochs;
}

/**
 * Rewrites each reload action's `parent_agent_call_id` to its completion
 * epoch's anchor key (the first pcid seen in that epoch) so a sequential
 * sub-agent invocation reload-collapses onto the SAME grouping key the live
 * stream used (#5386) — mutates `toolActions` in place, exactly as the
 * source does, and returns it for convenience.
 */
export function collapseSubAgentInvocationKeys<A extends SubAgentGroupable>(
  toolActions: A[],
  opts: SubAgentGroupingOptions<A>,
): A[] {
  const parallelNames = findParallelNames(toolActions, opts.deriveName, opts.deriveRawKey);
  const epochs = buildEpochs(toolActions, parallelNames, opts);
  // Pass 2 (lines 197-203): stamp every action in an epoch with its anchor key.
  epochs.forEach(({ epoch, name }) => {
    const key = epoch.anchor || name;
    epoch.actions.forEach((action) => {
      action.parent_agent_call_id = key;
    });
  });
  return toolActions;
}
