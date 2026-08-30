/**
 * The per-NODE half of graph admission — see `./graphAdmission.types.ts` for
 * what admission means and why the editor mirrors it. Six rules live here:
 * `node.type`, `node.id`, `node.required-field`, `node.route-target`,
 * `node.state-reference` and `node.structured-output`.
 *
 * Split from `./graphAdmission.helpers.ts` for the §3.5 400-line file
 * budget only; the two halves share `AdmissionGraph` and are composed into
 * one catalogue by `GRAPH_ADMISSION_RULES` there.
 */
import { FlowEditorConstants, RuntimeContractConstants } from './flow-editor/constants';
import type { RouteTargetRef } from './graphAdmission.nodeReads';
import {
  BUILTIN_STATE_KEYS,
  RESERVED_NODE_ID,
  dataOutputs,
  declaredStateReferences,
  isValidGraphId,
  isValidOutputKey,
  isValidToolIdentity,
  namedRoutes,
  routeTargetsOf,
} from './graphAdmission.nodeReads';
import type { AdmissionGraph, AdmissionNode, GraphAdmissionIssue, GraphAdmissionRule } from './graphAdmission.types';
import { admissionIssue, countNonStringEntries, toStringList } from './graphAdmission.types';

const { MAX_NODE_ID_BYTES, isCompilerAdmittedNodeType } = RuntimeContractConstants;

/** The one route/transition target legal without naming a node — `compiler.rs:484`, `router.rs:331`, `hitl.rs:464`. */
const END_TARGET: string = FlowEditorConstants.PipelineNodeTypes.End;

// ── rules ────────────────────────────────────────────────────────────────

const nodeTypeRule: GraphAdmissionRule = {
  id: 'node.type',
  citation: 'compiler.rs:1242-1270',
  summary: 'every node `type:` has a `parse_pipeline_node` arm',
  check: (graph) =>
    graph.nodes
      .filter((node) => !isCompilerAdmittedNodeType(node.type))
      .map((node) =>
        admissionIssue(
          'node.type',
          'compiler.rs:1267',
          node.id,
          'type',
          node.type,
          `type: "${node.type}" is not a node type this runtime can run — the whole pipeline is refused.`,
        ),
      ),
};

const nodeIdRule: GraphAdmissionRule = {
  id: 'node.id',
  citation: 'yaml.rs:362-369, compiler.rs:1220-1229',
  summary: 'node ids are well-formed, unique, and not the compiler-owned reserved id',
  check: (graph) => graph.nodes.flatMap((node, index) => nodeIdIssues(graph, node, index)),
};

function nodeIdIssues(graph: AdmissionGraph, node: AdmissionNode, index: number): readonly GraphAdmissionIssue[] {
  if (!isValidGraphId(node.id)) {
    return [
      admissionIssue(
        'node.id',
        'yaml.rs:362',
        node.id,
        'id',
        node.id,
        `id: "${node.id}" is not a legal node id — only letters, digits and _ - . : are allowed (a space is not), 1-${String(MAX_NODE_ID_BYTES)} bytes.`,
      ),
    ];
  }
  if (node.id === RESERVED_NODE_ID) {
    return [admissionIssue('node.id', 'compiler.rs:1220', node.id, 'id', node.id, `id: "${node.id}" is reserved by the runtime.`)];
  }
  const isDuplicate = graph.nodes.findIndex((other) => other.id === node.id) !== index;
  if (isDuplicate) {
    return [admissionIssue('node.id', 'compiler.rs:1225', node.id, 'id', node.id, `id: "${node.id}" is used by more than one node — node ids must be unique.`)];
  }
  return [];
}

const requiredFieldRule: GraphAdmissionRule = {
  id: 'node.required-field',
  citation: 'application.rs:53-54/124/146, direct_tool.rs:52-53/159, printer.rs:41, decision.rs:40, hitl.rs:470-478',
  summary: 'each node family carries the fields its serde struct requires',
  check: (graph) => graph.nodes.flatMap((node) => requiredFieldIssues(node)),
};

function requiredFieldIssues(node: AdmissionNode): readonly GraphAdmissionIssue[] {
  if (node.type === 'agent') return agentRequiredFields(node);
  if (node.type === 'toolkit' || node.type === 'mcp') return directToolRequiredFields(node);
  if (node.type === 'printer') return printerRequiredFields(node);
  if (node.type === 'decision') return decisionRequiredFields(node);
  if (node.type === 'hitl') return hitlRequiredFields(node);
  return [];
}

/** `application.rs:53` (`tool` required), `:124` (`valid_application_alias`), `:146` (exactly one `task` mapping). */
function agentRequiredFields(node: AdmissionNode): readonly GraphAdmissionIssue[] {
  const issues: GraphAdmissionIssue[] = [];
  if (!isValidToolIdentity(node.raw.tool)) {
    issues.push(
      admissionIssue('node.required-field', 'application.rs:124', node.id, 'tool', String(node.raw.tool ?? ''), 'tool: an Agent node must name the agent it runs; this one is empty.'),
    );
  }
  const mappingKeys = Object.keys(node.raw.input_mapping ?? {});
  if (mappingKeys.length !== 1 || mappingKeys[0] !== 'task') {
    issues.push(
      admissionIssue(
        'node.required-field',
        'application.rs:146',
        node.id,
        'input_mapping',
        mappingKeys.join(', '),
        `input_mapping: an Agent node needs exactly one entry, keyed "task" — found ${mappingKeys.length === 0 ? 'none' : `[${mappingKeys.join(', ')}]`}.`,
      ),
    );
  }
  return issues;
}

/** `direct_tool.rs:52-53` (both required), `:159` (`valid_tool_identity` on both). */
function directToolRequiredFields(node: AdmissionNode): readonly GraphAdmissionIssue[] {
  return (['toolkit_name', 'tool'] as const)
    .filter((field) => !isValidToolIdentity(node.raw[field]))
    .map((field) =>
      admissionIssue(
        'node.required-field',
        'direct_tool.rs:159',
        node.id,
        field,
        String(node.raw[field] ?? ''),
        `${field}: required by a ${node.type} node, and currently empty — pick a toolkit and an action.`,
      ),
    );
}

/** `printer.rs:41` — `transition` carries no `#[serde(default)]`, so a Printer without one never deserializes. */
function printerRequiredFields(node: AdmissionNode): readonly GraphAdmissionIssue[] {
  if (typeof node.raw.transition === 'string') return [];
  return [admissionIssue('node.required-field', 'printer.rs:41', node.id, 'transition', '', 'transition: a Printer node must name where it goes next (a node id, or END).')];
}

/**
 * `decision.rs:40` — `nodes` carries no `#[serde(default)]`, so the field
 * must be present. An EMPTY list is legal (`router.rs:70` bounds the length
 * from above only) and is left alone here on purpose: a fresh Decision node
 * is seeded `nodes: []` and would otherwise be unsaveable the moment it is
 * added.
 */
function decisionRequiredFields(node: AdmissionNode): readonly GraphAdmissionIssue[] {
  if (Array.isArray(node.raw.nodes)) return [];
  return [admissionIssue('node.required-field', 'decision.rs:40', node.id, 'nodes', '', 'nodes: a Decision node must declare its branch list (it may be empty, but it must exist).')];
}

/** `hitl.rs:470-478` — approve, reject, or a real edit route with an `edit_state_key`; otherwise the node can do nothing. */
function hitlRequiredFields(node: AdmissionNode): readonly GraphAdmissionIssue[] {
  const named = namedRoutes(node.raw);
  const editIsReal = typeof named['edit'] === 'string' && named['edit'] !== END_TARGET && typeof node.raw.edit_state_key === 'string';
  if (typeof named['approve'] === 'string' || typeof named['reject'] === 'string' || editIsReal) return [];
  return [
    admissionIssue('node.required-field', 'hitl.rs:474', node.id, 'routes', '', 'routes: a HITL node needs at least one action — an approve route, a reject route, or an edit route with an edit_state_key.'),
  ];
}

const routeTargetRule: GraphAdmissionRule = {
  id: 'node.route-target',
  citation: 'router.rs:330-335, compiler.rs:482-490',
  summary: 'every route/transition target is END or a declared node id',
  check: (graph) => graph.nodes.flatMap((node) => routeTargetsOf(node).flatMap((ref) => routeTargetIssues(graph, node, ref))),
};

function routeTargetIssues(graph: AdmissionGraph, node: AdmissionNode, ref: RouteTargetRef): readonly GraphAdmissionIssue[] {
  if (ref.target === END_TARGET) return [];
  if (!isValidGraphId(ref.target)) {
    return [
      admissionIssue(
        'node.route-target',
        'router.rs:331',
        node.id,
        ref.field,
        ref.target,
        `${ref.field}: "${ref.target}" is not a legal target — it must be END or a node id (letters, digits, _ - . :).`,
      ),
    ];
  }
  if (!graph.nodeIds.has(ref.target)) {
    return [admissionIssue('node.route-target', 'compiler.rs:484', node.id, ref.field, ref.target, `${ref.field}: "${ref.target}" does not name any node in this pipeline.`)];
  }
  return [];
}

const stateReferenceRule: GraphAdmissionRule = {
  id: 'node.state-reference',
  citation: 'compiler.rs:1277-1290, 1293-1338, 1344-1351',
  summary: 'every state key a node reads or writes is declared in `state:` (or is a runtime built-in)',
  check: (graph) => graph.nodes.flatMap((node) => stateReferenceIssues(graph, node)),
};

function stateReferenceIssues(graph: AdmissionGraph, node: AdmissionNode): readonly GraphAdmissionIssue[] {
  const undeclared = declaredStateReferences(node)
    .filter((ref) => !BUILTIN_STATE_KEYS.has(ref.target) && !graph.stateKeys.has(ref.target))
    .map((ref) =>
      admissionIssue(
        'node.state-reference',
        'compiler.rs:1284',
        node.id,
        ref.field,
        ref.target,
        `${ref.field}: "${ref.target}" is not declared in this pipeline's state — declare it in State, or point this field at a key that exists.`,
      ),
    );
  return [...undeclared, ...malformedListEntries(node), ...hitlEditStateKeyIssues(graph, node)];
}

/** A non-string entry in `input`/`output`/`variables_to_clean` fails `Vec<String>` deserialization before any rule runs. */
function malformedListEntries(node: AdmissionNode): readonly GraphAdmissionIssue[] {
  return (['input', 'output', 'variables_to_clean'] as const)
    .filter((field) => countNonStringEntries(node.raw[field]) > 0)
    .map((field) => admissionIssue('node.state-reference', 'llm.rs:163', node.id, field, '', `${field}: every entry must be a state-variable name.`))
    .concat(
      toStringList(node.raw.output)
        .filter((key) => !isValidOutputKey(key))
        .map((key) => admissionIssue('node.state-reference', 'yaml.rs:371', node.id, 'output', key, `output: "${key}" is not a legal state-variable name.`)),
    );
}

/** `compiler.rs:1344-1351` — `edit_state_key` is checked against `state:` with NO built-in escape, unlike every other key. */
function hitlEditStateKeyIssues(graph: AdmissionGraph, node: AdmissionNode): readonly GraphAdmissionIssue[] {
  const key = node.raw.edit_state_key;
  if (node.type !== 'hitl' || typeof key !== 'string' || key === '') return [];
  if (graph.stateKeys.has(key)) return [];
  return [
    admissionIssue(
      'node.state-reference',
      'compiler.rs:1348',
      node.id,
      'edit_state_key',
      key,
      `edit_state_key: "${key}" must be declared in this pipeline's state — a HITL edit key gets no built-in fallback.`,
    ),
  ];
}

const structuredOutputRule: GraphAdmissionRule = {
  id: 'node.structured-output',
  citation: 'llm.rs:171-190, direct_tool.rs:182-186',
  summary: 'structured nodes name at least one data output; non-structured LLM nodes name at most one',
  check: (graph) => graph.nodes.flatMap((node) => structuredOutputIssues(node)),
};

function structuredOutputIssues(node: AdmissionNode): readonly GraphAdmissionIssue[] {
  const structured = node.raw.structured_output === true;
  const outputs = dataOutputs(node.raw);
  if (node.type === 'llm') return llmStructuredOutputIssues(node, structured, outputs);
  if ((node.type === 'toolkit' || node.type === 'mcp') && structured && outputs.length === 0) {
    return [
      admissionIssue('node.structured-output', 'direct_tool.rs:182', node.id, 'output', '', 'output: structured output needs a state variable to write into — "messages" alone is not enough.'),
    ];
  }
  return [];
}

function llmStructuredOutputIssues(node: AdmissionNode, structured: boolean, outputs: readonly string[]): readonly GraphAdmissionIssue[] {
  if (structured && outputs.length === 0) {
    return [admissionIssue('node.structured-output', 'llm.rs:186', node.id, 'output', '', 'output: a structured LLM node must name at least one output other than "messages".')];
  }
  if (!structured && outputs.length > 1) {
    return [
      admissionIssue(
        'node.structured-output',
        'llm.rs:182',
        node.id,
        'output',
        outputs.join(', '),
        `output: a non-structured LLM node may write only one data output — found ${String(outputs.length)} (${outputs.join(', ')}). Turn on Structured output, or drop one.`,
      ),
    ];
  }
  return [];
}

/** The six per-node rules, in the order the compiler would hit them. */
export const NODE_ADMISSION_RULES: readonly GraphAdmissionRule[] = [
  nodeTypeRule,
  nodeIdRule,
  requiredFieldRule,
  routeTargetRule,
  stateReferenceRule,
  structuredOutputRule,
];
