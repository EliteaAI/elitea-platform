import { describe, expect, it } from 'vitest';

import { parseYamlToMermaid } from './parseYamlToMermaid.helpers';

describe('parseYamlToMermaid', () => {
  it('returns "" for invalid YAML (parse error swallowed)', () => {
    expect(parseYamlToMermaid('nodes: [unterminated')).toBe('');
  });

  it('returns "" for an empty-string document (js-yaml 5.x throws "expected a document, but the input is empty" on load(""), unlike the baseline\'s js-yaml 4.x which returned undefined without throwing — a real, verified dependency-version behaviour difference, caught by this same catch-and-return-"" path)', () => {
    expect(parseYamlToMermaid('')).toBe('');
  });

  it('renders a bare "graph TD" header for a document with no nodes ({})', () => {
    expect(parseYamlToMermaid('{}')).toBe('graph TD\n');
  });

  it('renders the entry point as a Start node edge', () => {
    const yaml = `
entry_point: first
nodes:
  - id: first
`;
    const out = parseYamlToMermaid(yaml);
    expect(out).toContain('start((Start))');
    expect(out).toContain('start --> first');
    expect(out).toContain('first["first"]');
  });

  it('renders a transition edge between two nodes', () => {
    const yaml = `
nodes:
  - id: a
    transition: b
  - id: b
`;
    const out = parseYamlToMermaid(yaml);
    expect(out).toContain('a --> b');
  });

  it('sanitizes node ids for Mermaid compatibility', () => {
    const yaml = `
nodes:
  - id: "weird id!"
    transition: "next-node"
`;
    const out = parseYamlToMermaid(yaml);
    expect(out).toContain('weird_id_["weird id!"]');
    expect(out).toContain('weird_id_ --> next_node');
  });

  it('renders a simple if/else Jinja condition as labelled branches', () => {
    const yaml = `
nodes:
  - id: check
    condition:
      condition_definition: '{% if "x" == "y" %}yes_branch{% else %}no_branch{% endif %}'
`;
    const out = parseYamlToMermaid(yaml);
    expect(out).toContain('check_condition{"Condition"}');
    expect(out).toContain('check --> check_condition');
    expect(out).toContain('check_condition -->|x == y| yes_branch');
    expect(out).toContain('check_condition --> no_branch');
  });

  it('does not render a condition block for a router-type node even if condition_definition is present', () => {
    const yaml = `
nodes:
  - id: r
    type: router
    condition:
      condition_definition: '{% if "x" == "y" %}a{% endif %}'
    routes: [a, b]
`;
    const out = parseYamlToMermaid(yaml);
    expect(out).not.toContain('r_condition');
  });

  it('renders a legacy decision node (node.decision) with an intermediate Decision diamond', () => {
    const yaml = `
nodes:
  - id: d
    decision:
      nodes: [x, y]
      default_output: z
`;
    const out = parseYamlToMermaid(yaml);
    expect(out).toContain('d_decision{"Decision"}');
    expect(out).toContain('d --> d_decision');
    expect(out).toContain('d_decision --> x');
    expect(out).toContain('d_decision --> y');
    expect(out).toContain('d_decision --> z');
  });

  it('renders a type-based decision node without an intermediate diamond', () => {
    const yaml = `
nodes:
  - id: d
    type: decision
    nodes: [x]
    default_output: z
`;
    const out = parseYamlToMermaid(yaml);
    expect(out).not.toContain('d_decision');
    expect(out).toContain('d --> x');
    expect(out).toContain('d --> z');
  });

  it('renders a router node\'s routes and default_output', () => {
    const yaml = `
nodes:
  - id: r
    type: router
    routes: [a, b]
    default_output: fallback
`;
    const out = parseYamlToMermaid(yaml);
    expect(out).toContain('r --> a');
    expect(out).toContain('r --> b');
    expect(out).toContain('r --> fallback');
  });

  it('renders a HITL node\'s action-labelled routes (object shape, not array)', () => {
    const yaml = `
nodes:
  - id: h
    type: hitl
    routes:
      approve: next
      reject: end
`;
    const out = parseYamlToMermaid(yaml);
    expect(out).toContain('h -->|approve| next');
    expect(out).toContain('h -->|reject| end');
  });

  it('skips a HITL route entry whose target is empty', () => {
    const yaml = `
nodes:
  - id: h
    type: hitl
    routes:
      approve: ""
      reject: end
`;
    const out = parseYamlToMermaid(yaml);
    expect(out).not.toContain('approve');
    expect(out).toContain('h -->|reject| end');
  });

  it('handles a document with no nodes array at all', () => {
    const out = parseYamlToMermaid('entry_point: missing');
    expect(out).toContain('start((Start))');
    expect(out).toContain('start --> missing');
  });
});
