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

import type { YamlPipelineDocument } from '../../lib/flow-editor/helpers/pipelineFlow.types';
import { usePipelineYamlStore } from '../../model/pipelineYamlStore';
import { useGraphAdmission } from './useGraphAdmission';

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
    usePipelineYamlStore.setState({ yamlCode: 'seeded', yamlJsonObject: ADMISSIBLE });
    const { result } = renderHook(() => useGraphAdmission());

    expect(result.current.hasGraph).toBe(true);
    expect(result.current.issues).toEqual([]);
  });
});
