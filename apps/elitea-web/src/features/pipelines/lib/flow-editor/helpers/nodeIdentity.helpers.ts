/**
 * Node-id minting for the pipeline flow editor, split out of
 * `./flowEditor.helpers.ts` (which re-exports all three public symbols) to
 * keep both files under the §3.5 400-line budget.
 *
 * This module is where the editor meets the runtime's graph-identifier
 * grammar. Everything it does is dictated by
 * `services/elitea-worker-rust/src/agents/graph/yaml.rs:362`
 * (`valid_graph_id`) — see the comments on each export.
 */
import {
  CONDITION_NODE_ID_SUFFIX,
  InitialNodeId,
  PipelineNodeTypes,
} from '../constants/flowEditor.constants';
import { InitialNodeData } from '../constants/nodeDefaults.constants';
import {
  MAX_NODE_ID_BYTES,
  NODE_ID_PATTERN,
  NODE_ID_WORD_SEPARATOR,
} from '../constants/runtimeContract.constants';

/**
 * Whether the pipeline compiler will accept `id` as a graph identifier —
 * the editor-side mirror of `valid_graph_id`
 * (`services/elitea-worker-rust/src/agents/graph/yaml.rs:362`), which the
 * runtime runs over every node's `id`, over `entry_point`
 * (`compiler.rs:464`), and over every route/transition target.
 *
 * Byte length is compared against character length deliberately:
 * {@link NODE_ID_PATTERN} admits only ASCII, so for any string that passes
 * it the two are equal, and for any string that fails it the length check is
 * moot.
 */
export const isCompilerLegalNodeId = (id: string): boolean =>
  NODE_ID_PATTERN.test(id) && id.length <= MAX_NODE_ID_BYTES;

/**
 * Uniqueness key for minted ids. Whitespace AND `_` are both erased before
 * comparing, so a document that already carries a legacy space-separated
 * `Agent 1` does not get a visually indistinguishable `Agent_1` minted
 * beside it — the counter skips to `Agent_2` instead. (The baseline
 * compared on whitespace alone, which was sufficient while every id it
 * minted used a space.)
 */
const nodeIdUniquenessKey = (id: string): string => id.replace(/[\s_]/g, '');

/**
 * Mint the next free id for a node of `type`.
 *
 * **The separator is `_`, not a space** — `valid_graph_id`
 * (`yaml.rs:362`) admits ASCII alphanumerics plus `_ - . :` and NOTHING
 * else, so the previous `` `${namePrefix} ${index + 1}` `` produced
 * `"Agent 1"`, an id the compiler refuses. Because the editor also assigns
 * `entry_point` to the first node added
 * (`ui/useFlowEditorNodeOperations.ts`), the very first node a user added
 * made the whole document unloadable
 * (`graph.pipeline.invalid_configuration`). The SDK worker hid this by
 * silently rewriting ids through `clean_string`; the Rust runtime never
 * rewrites.
 *
 * The id doubles as the node's DISPLAY name throughout the editor
 * (`useFlowEditorNodeOperations` seeds `data.label` from it, `parseYaml`
 * re-derives it on every layout pass, and `NodeCardHeader`'s rename writes
 * both at once), so a label that differed from the id would silently
 * re-converge on the next re-layout. `Agent_1` is therefore both the id and
 * what the card shows.
 *
 * **Stored documents are NOT touched.** Nothing here rewrites the ids of a
 * pipeline that already contains `"Agent 1"`. Doing that on open would be a
 * silent data mutation reaching `entry_point`, every `transition`, every
 * `routes` value and every `nodes:` entry of every Decision — and it would
 * happen without the user asking or being told. Whether such documents get
 * migrated (and by whom, with what backup) is an open product question, not
 * something the editor should decide on load.
 */
const getNormalInitialNodeId = (type: string, nodes: readonly { readonly id: string }[] = []): string => {
  const takenIds = nodes.map(node => nodeIdUniquenessKey(node.id));
  const namePrefix = InitialNodeId[type] ?? InitialNodeId[PipelineNodeTypes.Custom] ?? 'Custom';
  for (let index = 0; ; index++) {
    const newId = `${namePrefix}${NODE_ID_WORD_SEPARATOR}${index + 1}`;
    if (!takenIds.includes(nodeIdUniquenessKey(newId))) {
      return newId;
    }
  }
};

/**
 * Condition keeps its timestamped `~~~ConditionNode` id: that suffix is not
 * compiler-legal, but a Condition node is never written into the YAML
 * document at all (`useFlowEditorNodeOperations.ts` skips the
 * `setYamlJsonObject` call for it) — the id exists only as a synthetic
 * canvas handle for a deprecated, menu-hidden node type.
 */
export const getInitialNodeId = (type: string, nodes: readonly { readonly id: string }[] = []): string =>
  type !== PipelineNodeTypes.Condition
    ? getNormalInitialNodeId(type, nodes)
    : `Condition${new Date().getTime()}${CONDITION_NODE_ID_SUFFIX}`;

export const generateNodeIdByType = (
  type: string,
  nodes: readonly { readonly id: string }[],
): { id: string; type: string; [key: string]: unknown } => ({
  id: getInitialNodeId(type, nodes),
  type,
  ...InitialNodeData[type],
});
