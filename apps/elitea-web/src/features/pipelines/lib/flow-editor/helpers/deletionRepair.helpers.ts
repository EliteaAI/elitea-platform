/**
 * The repairs the deletion path applies to a node that referenced a node the
 * user just deleted. Split out of `deletionOperations.helpers.ts` to keep that
 * file under `max-lines`; every rule here is quoted from the Rust node schemas
 * the stored document must satisfy.
 */
import { DEFAULT_OUTPUT, PipelineNodeTypes } from '../constants/flowEditor.constants';
import type { YamlPipelineNode } from './pipelineFlow.types';
import * as NodeOperationsHelpers from './nodeOperations.helpers';

/**
 * The one HITL action that must be REMOVED rather than repaired to END when
 * its target is deleted. Spelled as a literal here to match the rest of the
 * feature (`graphAdmission.nodeReads.ts:113`,
 * `connectionOperations.helpers.ts:165`), which has no shared constant for it.
 */
export const HITL_EDIT_ACTION = 'edit';

/**
 * The single-target repair every branch of `cleanupNodeReferences`
 * shares. Two rules, both taken from the Rust node schemas:
 *
 * 1. An ABSENT key stays absent (`undefined` tells the caller to leave the
 *    node alone). The old `field ?? ''` shape materialised the key on nodes
 *    that never declared it — `transition: ''` on a Router
 *    (`RawRouterNodeDefinition` is `#[serde(deny_unknown_fields)]` with no
 *    `transition`, `router.rs:31-43`) and `default_output: ''` on a Decision
 *    that legally omitted it (`decision.rs:48` defaults it to `"END"`).
 * 2. A target that pointed at the deleted node becomes `END`, never `''`.
 *    `validate_target('')` fails (`router.rs:331` via `yaml.rs:372`), so `''`
 *    is refused by the compiler AND by the gate's `node.route-target` — which
 *    disabled Save and blamed a field the user never edited.
 */
export function repairTargetIfMatches(current: string | undefined, nodeId: string): string | undefined {
  if (current === undefined) return undefined;
  return current === nodeId ? PipelineNodeTypes.End : current;
}

/**
 * `hitl.rs:459-466` — `validate_routes` iterates only the routes that are
 * PRESENT, so removing a route key is always legal, while leaving `''`
 * behind is refused ("a HITL route target is malformed").
 *
 * `approve`/`reject` become `END`: both count towards `has_action`
 * (`hitl.rs:468-472`) whether or not they point at END, so the node stays
 * saveable. `edit` is OMITTED instead — an `edit` route equal to END does NOT
 * count towards `has_action` (`hitl.rs:470`), and `HITLNode.parts.tsx:352`
 * reads any truthy `routes.edit` as configured, so `'END'` would paint the red
 * "Provide an edit state key" error on a node whose neighbour was deleted.
 */
/**
 * Router and the new-style Decision both carry their branch list and their
 * single default target ON the node. The node phase used to leave BOTH alone
 * and rely on the queued edges to repair them; the deferred `setFlowNodes`
 * updater is why that is no longer trusted — the node phase has to leave a
 * legal document on its own. Both repairs are idempotent, so the edge phase
 * running afterwards is harmless.
 */
export function repairBranchNode(yamlNode: YamlPipelineNode, nodeId: string): YamlPipelineNode {
  const branchField = yamlNode.type === PipelineNodeTypes.Router ? 'routes' : 'nodes';
  const branches = yamlNode[branchField] as readonly string[] | undefined;
  const repaired = repairTargetIfMatches(yamlNode[DEFAULT_OUTPUT], nodeId);
  return {
    ...yamlNode,
    ...(branches === undefined ? {} : { [branchField]: NodeOperationsHelpers.removeNodeIdFromArray(branches, nodeId) }),
    ...(repaired === undefined ? {} : { [DEFAULT_OUTPUT]: repaired }),
  };
}

export function repairHitlRoutes(routes: Record<string, string>, nodeId: string): Record<string, string> {
  return Object.entries(routes).reduce<Record<string, string>>((result, [action, target]) => {
    if (target !== nodeId) return { ...result, [action]: target };
    if (action === HITL_EDIT_ACTION) return result;
    return { ...result, [action]: PipelineNodeTypes.End };
  }, {});
}

