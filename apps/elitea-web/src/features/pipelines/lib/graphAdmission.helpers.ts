/**
 * Pipeline **graph admission** — the editor's transcription of the Rust
 * pipeline compiler's own refusals. See `./graphAdmission.types.ts` for the
 * full "what and why"; this file holds the document/`state:` rules, the rule
 * catalogue, and the one entry point the UI calls.
 *
 * ## How to use it
 *
 * ```ts
 * const issues = collectGraphAdmissionIssues(yamlJsonObject);
 * if (issues.length > 0) { /* refuse the save, show issuesForNode(...) *\/ }
 * ```
 *
 * ## What it is NOT
 *
 * It is not a second authority and not a superset. Where the compiler
 * accepts something the editor finds odd — an empty Decision `nodes:` list,
 * a state key nobody reads — this module stays quiet, because refusing a
 * save the runtime would have accepted is its own defect. Every rule below
 * names the runtime `file:line` it mirrors; that citation is the diff to
 * re-check when `services/elitea-worker-rust/src/agents/graph/` changes.
 */
import { RuntimeContractConstants } from './flow-editor/constants';
import type { YamlPipelineDocument } from './flow-editor/helpers/pipelineFlow.types';
import { isValidGraphId, isValidOutputKey } from './graphAdmission.nodeReads';
import { NODE_ADMISSION_RULES } from './graphAdmission.nodes';
import type { AdmissionGraph, AdmissionNode, GraphAdmissionIssue, GraphAdmissionRule } from './graphAdmission.types';
import { admissionIssue, readNodeIdentity } from './graphAdmission.types';

const { isReservedStateKey } = RuntimeContractConstants;

/** `compiler.rs:51` — `MAX_PIPELINE_NODES`. */
const MAX_PIPELINE_NODES = 128;

/** `compiler.rs:52` — `MAX_PIPELINE_STATE_KEYS`. */
const MAX_PIPELINE_STATE_KEYS = 256;

/** `compiler.rs:1378-1390` — every state type the compiler normalises, mapped to the normalised name it becomes. */
const STATE_TYPE_ALIASES: ReadonlyMap<string, string> = new Map([
  ['str', 'str'],
  ['string', 'str'],
  ['int', 'int'],
  ['number', 'int'],
  ['float', 'float'],
  ['bool', 'bool'],
  ['list', 'list'],
  ['dict', 'dict'],
]);

/** `compiler.rs:1391-1394` — the two built-in keys whose declared type is pinned. */
const PINNED_BUILTIN_STATE_TYPES: ReadonlyMap<string, string> = new Map([
  ['input', 'str'],
  ['messages', 'list'],
]);

/** The declared type name of one `state:` entry — a bare string, or a `{type, value}` descriptor (`compiler.rs:100-114`). */
function readStateTypeName(spec: unknown): string | undefined {
  if (typeof spec === 'string') return spec;
  if (spec !== null && typeof spec === 'object' && 'type' in spec) {
    const declared = (spec as { readonly type?: unknown }).type;
    return typeof declared === 'string' ? declared : undefined;
  }
  return undefined;
}

/** Normalise a document into the lookup sets every rule reads. Runs once per collection pass. */
function readAdmissionGraph(document: YamlPipelineDocument | undefined): AdmissionGraph {
  const safeDocument: YamlPipelineDocument = document ?? {};
  const nodes: readonly AdmissionNode[] = (safeDocument.nodes ?? []).map((raw) => ({ ...readNodeIdentity(raw), raw }));
  const stateEntries = Object.entries(safeDocument.state ?? {});
  return {
    document: safeDocument,
    nodes,
    nodeIds: new Set(nodes.map((node) => node.id)),
    stateKeys: new Set(stateEntries.map(([key]) => key)),
    stateTypes: new Map(stateEntries.map(([key, spec]) => [key, STATE_TYPE_ALIASES.get(readStateTypeName(spec) ?? '') ?? ''])),
  };
}

const nodeCountRule: GraphAdmissionRule = {
  id: 'document.node-count',
  citation: 'compiler.rs:459-463',
  summary: 'a pipeline holds between 1 and 128 nodes',
  check: (graph) => {
    const count = graph.nodes.length;
    if (count >= 1 && count <= MAX_PIPELINE_NODES) return [];
    return [
      admissionIssue(
        'document.node-count',
        'compiler.rs:459',
        undefined,
        'nodes',
        String(count),
        `nodes: a pipeline must hold between 1 and ${String(MAX_PIPELINE_NODES)} nodes — this one holds ${String(count)}.`,
      ),
    ];
  },
};

const entryPointRule: GraphAdmissionRule = {
  id: 'document.entry-point',
  citation: 'compiler.rs:464-468, 477-481',
  summary: '`entry_point` is a well-formed id and names a declared node',
  check: (graph) => entryPointIssues(graph),
};

function entryPointIssues(graph: AdmissionGraph): readonly GraphAdmissionIssue[] {
  const entryPoint = graph.document.entry_point;
  if (typeof entryPoint !== 'string' || !isValidGraphId(entryPoint)) {
    return [
      admissionIssue(
        'document.entry-point',
        'compiler.rs:464',
        undefined,
        'entry_point',
        typeof entryPoint === 'string' ? entryPoint : '',
        'entry_point: a pipeline must name the node it starts at, as a legal node id.',
      ),
    ];
  }
  if (!graph.nodeIds.has(entryPoint)) {
    return [
      admissionIssue('document.entry-point', 'compiler.rs:477', undefined, 'entry_point', entryPoint, `entry_point: "${entryPoint}" does not name any node in this pipeline.`),
    ];
  }
  return [];
}

/**
 * `compiler.rs:470-474`. The Rust compiler refuses ANY non-empty
 * `interrupt_before`/`interrupt_after` outright — "static pipeline
 * interrupts are not enabled in this compiler slice" — while the Python SDK
 * worker honours them. The editor cannot know which worker will run a given
 * turn, so it authors the INTERSECTION both accept: no static interrupts at
 * all. `ui/settings/CommonInterruptSettings.tsx` disables the two switches
 * for the same reason and says so on screen; this rule is what catches a
 * document that already carries them (authored before the switches were
 * disabled, or through the YAML tab).
 */
const staticInterruptRule: GraphAdmissionRule = {
  id: 'document.static-interrupts',
  citation: 'compiler.rs:470-474',
  summary: 'no static `interrupt_before`/`interrupt_after` entries',
  check: (graph) =>
    (['interrupt_before', 'interrupt_after'] as const)
      .filter((field) => (graph.document[field] ?? []).length > 0)
      .map((field) =>
        admissionIssue(
          'document.static-interrupts',
          'compiler.rs:470',
          undefined,
          field,
          (graph.document[field] ?? []).join(', '),
          `${field}: static interrupts are not supported by the native runtime — remove [${(graph.document[field] ?? []).join(', ')}] or the pipeline will not start.`,
        ),
      ),
};

const stateKeyRule: GraphAdmissionRule = {
  id: 'state.key',
  citation: 'compiler.rs:1358, 1373-1377 (yaml.rs:371, compiler.rs:1456)',
  summary: 'state keys are well-formed, not reserved, and within the 256-key bound',
  check: (graph) => stateKeyIssues(graph),
};

function stateKeyIssues(graph: AdmissionGraph): readonly GraphAdmissionIssue[] {
  const keys = [...graph.stateKeys];
  const overBound =
    keys.length > MAX_PIPELINE_STATE_KEYS
      ? [
          admissionIssue(
            'state.key',
            'compiler.rs:1358',
            undefined,
            'state',
            String(keys.length),
            `state: at most ${String(MAX_PIPELINE_STATE_KEYS)} variables — this pipeline declares ${String(keys.length)}.`,
          ),
        ]
      : [];
  return [...overBound, ...keys.flatMap((key) => stateKeyIssue(key))];
}

function stateKeyIssue(key: string): readonly GraphAdmissionIssue[] {
  if (!isValidOutputKey(key)) {
    return [admissionIssue('state.key', 'compiler.rs:1373', undefined, `state.${key}`, key, `state: "${key}" is not a legal variable name.`)];
  }
  if (isReservedStateKey(key)) {
    return [admissionIssue('state.key', 'compiler.rs:1373', undefined, `state.${key}`, key, `state: "${key}" is reserved by the runtime and cannot be declared here.`)];
  }
  return [];
}

const stateTypeRule: GraphAdmissionRule = {
  id: 'state.type',
  citation: 'compiler.rs:1370-1372, 1378-1390',
  summary: 'every state variable declares one of the six admitted types',
  check: (graph) =>
    [...graph.stateTypes.entries()]
      .filter(([, normalised]) => normalised === '')
      .map(([key]) =>
        admissionIssue(
          'state.type',
          'compiler.rs:1386',
          undefined,
          `state.${key}`,
          readStateTypeName(graph.document.state?.[key]) ?? '',
          `state.${key}: its type must be one of str, int, float, bool, list or dict.`,
        ),
      ),
};

const builtinStateTypeRule: GraphAdmissionRule = {
  id: 'state.builtin-type',
  citation: 'compiler.rs:1391-1395',
  summary: '`input` is declared `str` and `messages` is declared `list`',
  check: (graph) =>
    [...PINNED_BUILTIN_STATE_TYPES.entries()]
      .filter(([key, pinned]) => graph.stateTypes.has(key) && graph.stateTypes.get(key) !== pinned)
      .map(([key, pinned]) =>
        admissionIssue('state.builtin-type', 'compiler.rs:1391', undefined, `state.${key}`, graph.stateTypes.get(key) ?? '', `state.${key}: this built-in variable must be declared "${pinned}".`),
      ),
};

/**
 * Every admission rule, document-level first, then per-node — the order the
 * compiler itself hits them (`from_raw` before `parse_pipeline_nodes`).
 * Exported so the unit suite can assert one case per rule id and so nothing
 * here is reachable only from a test.
 */
export const GRAPH_ADMISSION_RULES: readonly GraphAdmissionRule[] = [
  nodeCountRule,
  entryPointRule,
  staticInterruptRule,
  stateKeyRule,
  stateTypeRule,
  builtinStateTypeRule,
  ...NODE_ADMISSION_RULES,
];

/** Every reason the Rust pipeline compiler would refuse `document`. Empty means "admissible". */
export function collectGraphAdmissionIssues(document: YamlPipelineDocument | undefined): readonly GraphAdmissionIssue[] {
  const graph = readAdmissionGraph(document);
  return GRAPH_ADMISSION_RULES.flatMap((rule) => rule.check(graph));
}

/** The issues a given node's panel should show. */
export function issuesForNode(issues: readonly GraphAdmissionIssue[], nodeId: string): readonly GraphAdmissionIssue[] {
  return issues.filter((issue) => issue.nodeId === nodeId);
}

/** The issues that belong to the document rather than to any one node (`entry_point`, `state:`, interrupts). */
export function documentLevelIssues(issues: readonly GraphAdmissionIssue[]): readonly GraphAdmissionIssue[] {
  return issues.filter((issue) => issue.nodeId === undefined);
}
