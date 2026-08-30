import { describe, expect, it } from 'vitest';

import { InitialNodeData } from './nodeDefaults.constants';
import * as RuntimeContractConstants from './runtimeContract.constants';
import {
  InitialNodeId,
  NodeDisplayLabels,
  NodeHeightMap,
  PipelineNodeDisplayNames,
  PipelineNodeTypeNames,
  PipelineNodeTypes,
  StateVariableTypes,
} from './flowEditor.constants';

describe('PipelineNodeTypeNames', () => {
  it('inverts PipelineNodeTypes (value -> declared key name)', () => {
    expect(PipelineNodeTypeNames[PipelineNodeTypes.Tool]).toBe('Tool');
    expect(PipelineNodeTypeNames[PipelineNodeTypes.LoopFromTool]).toBe('LoopFromTool');
    expect(PipelineNodeTypeNames[PipelineNodeTypes.End]).toBe('End');
  });
});

describe('NodeHeightMap / PipelineNodeDisplayNames / NodeDisplayLabels', () => {
  it('has an entry for every PipelineNodeTypes value', () => {
    for (const type of Object.values(PipelineNodeTypes)) {
      expect(NodeHeightMap[type]).toBeTypeOf('number');
      expect(PipelineNodeDisplayNames[type]).toBeTypeOf('string');
      expect(NodeDisplayLabels[type]).toBeTypeOf('string');
    }
  });

  it('Hitl label in NodeDisplayLabels matches PipelineNodeDisplayNames (not a hand-duplicated string)', () => {
    expect(NodeDisplayLabels[PipelineNodeTypes.Hitl]).toBe(PipelineNodeDisplayNames[PipelineNodeTypes.Hitl]);
  });
});

describe('InitialNodeId', () => {
  it('covers every PipelineNodeTypes value plus the synthetic run-state node', () => {
    for (const type of Object.values(PipelineNodeTypes)) {
      expect(InitialNodeId[type]).toBeTypeOf('string');
    }
    expect(InitialNodeId['run_state']).toBe('RunState');
  });
});

describe('InitialNodeData', () => {
  it('seeds a Tool node with an empty tool ref and structured-output defaults', () => {
    expect(InitialNodeData[PipelineNodeTypes.Tool]).toEqual({
      tool: '',
      input: [],
      output: [],
      transition: PipelineNodeTypes.End,
      structured_output: false,
    });
  });

  it('seeds a Condition node with empty condition fields', () => {
    expect(InitialNodeData[PipelineNodeTypes.Condition]).toEqual({
      condition_input: [],
      condition_definition: '',
      conditional_outputs: [],
      default_output: '',
    });
  });

  it('seeds a Function node by layering onto the Tool shape (input_mapping added, function undefined)', () => {
    const fn = InitialNodeData[PipelineNodeTypes.Function];
    expect(fn?.['tool']).toBe('');
    expect(fn?.['input_mapping']).toEqual({});
    expect(fn?.['function']).toBeUndefined();
  });
});

/**
 * Every seeded default of a COMPILER-ADMITTED node type, checked against the
 * Rust pipeline compiler's own requirements
 * (`services/elitea-worker-rust/src/agents/graph/`). Before this pass a
 * freshly added node of several types produced a document the compiler
 * refuses outright — the whole pipeline, not just that node.
 */
describe('InitialNodeData: the Rust compiler admits every freshly seeded node', () => {
  it('seeds an Agent node with the two fields serde REQUIRES, and exactly one `task` input mapping', () => {
    // `application.rs:53-54` — `tool` and `input_mapping` carry no
    // `#[serde(default)]`, so a node without them fails to deserialize and
    // the document is rejected as "an Agent node is invalid"
    // (`compiler.rs:1248`). `application.rs:146` then demands the mapping
    // hold EXACTLY one entry, keyed `task`.
    const agent = InitialNodeData[PipelineNodeTypes.Agent];
    expect(agent).toHaveProperty('tool');
    expect(Object.keys(agent?.['input_mapping'] as Record<string, unknown>)).toEqual(['task']);
    expect(agent?.['transition']).toBe(PipelineNodeTypes.End);
  });

  it('leaves the Agent `tool` participant alias EMPTY rather than guessing it', () => {
    // `valid_application_alias` (`application.rs:609`) refuses `''`, so the
    // node reads as "required, not filled". Deliberate: the runtime calls
    // this a participant alias (`application.rs:49`) and no legacy artefact
    // pins which string resolves to a saved agent. Seeding a guess would
    // bake an unverified contract into every new pipeline.
    expect(InitialNodeData[PipelineNodeTypes.Agent]?.['tool']).toBe('');
  });

  it.each([PipelineNodeTypes.Toolkit, PipelineNodeTypes.Mcp])(
    'seeds a %s node with the required toolkit_name/tool pair and no unknown `function` key',
    type => {
      // `direct_tool.rs:52-53` — both required. `direct_tool.rs:46` is
      // `#[serde(deny_unknown_fields)]`, and `function` is not one of them.
      const node = InitialNodeData[type];
      expect(node).toHaveProperty('toolkit_name');
      expect(node).toHaveProperty('tool');
      expect(node?.['toolkit_name']).toBe('');
      expect(node?.['tool']).toBe('');
      expect(node).not.toHaveProperty('function');
    },
  );

  it.each([PipelineNodeTypes.Router, PipelineNodeTypes.Decision])(
    'seeds %s with default_output = END, never the empty string',
    type => {
      // `validate_target` (`router.rs:330`) admits only `END` or an id
      // passing `valid_graph_id`. `''` is neither, so the previous seed made
      // every fresh Router/Decision node reject the document.
      expect(InitialNodeData[type]?.['default_output']).toBe('END');
    },
  );

  it('seeds a Hitl node with every route target legal, no `edit` route, and no empty edit_state_key', () => {
    // `validate_routes` (`hitl.rs:464`): each declared target must be `END`
    // or a `valid_graph_id`. `edit_state_key` is `Option<String>` and
    // `Some("")` is refused (`hitl.rs:157-165`) — absent is `None`, legal.
    //
    // `edit` is ABSENT, and that is the assertion with teeth. `edit: 'END'`
    // is compiler-legal but `HITLNode.parts.tsx:352` reads any truthy
    // `routes.edit` as a configured edit route, so it painted "Provide an
    // edit state key before using the Edit route." on every freshly added
    // node; `edit: ''` is refused by `validate_target`. Only omission
    // satisfies both, because `HitlRoutes.edit` is `#[serde(default)]
    // Option<String>` (`hitl.rs:83-84`) and `approve` alone already
    // satisfies `has_action` (`hitl.rs:474-478`).
    const hitl = InitialNodeData[PipelineNodeTypes.Hitl];
    expect(hitl?.['routes']).toEqual({ approve: 'END', reject: 'END' });
    expect(hitl?.['edit_state_key']).toBeUndefined();
    // `validate_message` (`hitl.rs:440`) refuses an empty `user_message.value`;
    // this is the runtime's own `default_message` (`hitl.rs:625`) verbatim.
    expect(hitl?.['user_message']).toEqual({ type: 'fixed', value: 'Please review and approve to continue.' });
    for (const target of Object.values(hitl?.['routes'] as Record<string, string>)) {
      expect(target === 'END' || /^[A-Za-z0-9_.:-]+$/.test(target)).toBe(true);
    }
  });

  it('seeds a Printer node with the transition serde requires', () => {
    // `printer.rs:41` — `transition: String`, no `#[serde(default)]`.
    expect(InitialNodeData[PipelineNodeTypes.Printer]?.['transition']).toBe(PipelineNodeTypes.End);
  });

  it('never seeds an empty-string route target on any compiler-admitted node type', () => {
    const routeFields = ['transition', 'default_output'];
    for (const type of RuntimeContractConstants.CompilerAdmittedNodeTypes) {
      const node = InitialNodeData[type];
      if (!node) continue;
      for (const field of routeFields) {
        if (field in node) expect(node[field]).not.toBe('');
      }
    }
  });
});

describe('StateVariableTypes', () => {
  it('maps the four DSL type codes', () => {
    expect(StateVariableTypes).toEqual({ String: 'str', Number: 'number', List: 'list', Json: 'dict' });
  });
});
