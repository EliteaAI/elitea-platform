/**
 * The one thing this hook decides that the rule catalogue cannot: WHEN the
 * catalogue's answer is allowed to gate anything.
 *
 * `graphAdmission.helpers.test.ts` calls `collectGraphAdmissionIssues`
 * directly and so cannot see this guard at all, and
 * `GraphAdmissionGate.test.tsx` asserts the unseeded case as desired
 * behaviour without distinguishing "never seeded" from "the user deleted
 * every node". Those are the two states the guard has to tell apart, so
 * they are asserted here as a pair — either one alone passes against the
 * bug.
 */
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { dumpYaml } from '../../lib/dumpYaml.helpers';
import type { YamlPipelineDocument } from '../../lib/flow-editor/helpers/pipelineFlow.types';
import { usePipelineYamlStore } from '../../model/pipelineYamlStore';
import { useGraphAdmission } from './useGraphAdmission';

/**
 * Seed the store the way the real editor does: `yamlCode` and
 * `yamlJsonObject` in step. The two used to be seeded INCONSISTENTLY here
 * (`yamlCode: 'seeded'`, a placeholder that is not the document at all),
 * which was harmless only while this hook read `yamlJsonObject`. It reads the
 * live `yamlCode` now, because that is the string the save path stores.
 */
function seed(document: YamlPipelineDocument): void {
  usePipelineYamlStore.setState({ yamlCode: dumpYaml(document), yamlJsonObject: document });
}

/**
 * What `handleNormalNodeDeletion` leaves behind after the last node on the
 * canvas is deleted — `{...doc, nodes: [], entry_point: undefined}`. The
 * cast is the point of the fixture, not a shortcut: `exactOptionalProperty
 * Types` forbids writing `entry_point: undefined` against
 * `YamlPipelineDocument`, but the deletion helper produces exactly that
 * object at run time, and the KEY surviving with an `undefined` value is
 * what the guard has to see.
 */
const EMPTIED_CANVAS = { state: { input: 'str', messages: 'list' }, nodes: [], entry_point: undefined } as unknown as YamlPipelineDocument;

const ADMISSIBLE: YamlPipelineDocument = {
  state: { input: 'str', messages: 'list', summary: 'str' },
  entry_point: 'LLM_1',
  nodes: [{ id: 'LLM_1', type: 'llm', input: ['messages'], output: ['summary'], transition: 'END' }],
};

beforeEach(() => {
  usePipelineYamlStore.setState({ yamlCode: '', yamlJsonObject: {} });
});

describe('useGraphAdmission', () => {
  it('holds no graph while the editor has never been seeded', () => {
    const { result } = renderHook(() => useGraphAdmission());

    expect(result.current.hasGraph).toBe(false);
    expect(result.current.issues).toEqual([]);
  });

  it('reports an emptied canvas as a real graph the runtime would refuse (compiler.rs:459)', () => {
    // The half the old `nodes.length === 0` guard suppressed: deleting the
    // last node re-enabled Save on a document `PipelineDefinition::from_yaml`
    // refuses twice over — `entry_point` is a required non-defaulted field
    // and `raw.nodes.is_empty()` is refused outright. `usePipelineGraphDraft`
    // does NOT bail on this document (its `yamlCode` still carries `state:`),
    // so nothing else stood between it and a stored, unrunnable version.
    usePipelineYamlStore.setState({ yamlCode: 'state:\n  input: str\nnodes: []\n', yamlJsonObject: EMPTIED_CANVAS });
    const { result } = renderHook(() => useGraphAdmission());

    expect(result.current.hasGraph).toBe(true);
    expect(result.current.issues.map((issue) => issue.rule)).toEqual(['document.node-count', 'document.entry-point']);
  });

  it('leaves an admissible graph unblocked', () => {
    seed(ADMISSIBLE);
    const { result } = renderHook(() => useGraphAdmission());

    expect(result.current.hasGraph).toBe(true);
    expect(result.current.issues).toEqual([]);
    expect(result.current.parseFailed).toBe(false);
  });

  /**
   * THE YAML-TAB WINDOW. `EditorPanel`'s `onChangeCode` writes only
   * `yamlCode`; `onParseCodeToJson` runs only when the user clicks back to
   * Flow. So while the Yaml tab is open the two stores legitimately disagree
   * — and the save path (`usePipelineGraphDraft`) stores `yamlCode`.
   *
   * Judged on `yamlJsonObject`, as this hook used to be, the assertion below
   * reads "no issues": the last good parse is still the admissible document,
   * the banner stays clear, and Save stays enabled on a graph the runtime
   * refuses. The e2e that covers this surface always clicks Flow first, which
   * is exactly the step that closes the window.
   */
  it('judges the live yamlCode, not the canvas last-good parse, when the two disagree', () => {
    usePipelineYamlStore.setState({
      // `Agent 1` fails `valid_graph_id` (a space is not admitted) — typed in
      // the Yaml tab, so the canvas has not re-parsed it.
      yamlCode: dumpYaml({ ...ADMISSIBLE, entry_point: 'Agent 1', nodes: [{ ...ADMISSIBLE.nodes![0], id: 'Agent 1' }] }),
      yamlJsonObject: ADMISSIBLE,
    });
    const { result } = renderHook(() => useGraphAdmission());

    expect(result.current.hasGraph).toBe(true);
    expect(result.current.issues.map((issue) => issue.rule)).toContain('node.id');
  });

  /**
   * Text that is not YAML at all is refused as its own state rather than as
   * an issue: `GraphAdmissionIssue.rule` is a closed union of rules
   * transcribed from the compiler, and `serde_yaml` refuses before any of
   * them runs.
   */
  it('reports unparseable yamlCode as a graph that cannot be admitted', () => {
    usePipelineYamlStore.setState({ yamlCode: 'nodes: [\n  - id: "unterminated', yamlJsonObject: ADMISSIBLE });
    const { result } = renderHook(() => useGraphAdmission());

    expect(result.current.hasGraph).toBe(true);
    expect(result.current.parseFailed).toBe(true);
  });
});
