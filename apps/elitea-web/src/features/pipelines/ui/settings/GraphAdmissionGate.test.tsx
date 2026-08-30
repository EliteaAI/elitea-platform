/**
 * The save gate, exercised through a REAL react-hook-form instance and the
 * REAL pipeline yaml store — no module mocks (`elitea/no-vi-mock`). What is
 * asserted is the flag the pipeline editor's Save button is actually wired
 * to (`pages/pipelines/EditPipeline.tsx`: `canSave={form.formState.isValid
 * && !isSaving}`), not an internal of this component.
 */
import type { ReactNode } from 'react';
import { FormProvider, useForm } from 'react-hook-form';

import { act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import type { YamlPipelineDocument } from '../../lib/flow-editor/helpers/pipelineFlow.types';
import { usePipelineYamlStore } from '../../model/pipelineYamlStore';
import { GraphAdmissionGate } from './GraphAdmissionGate';

const ADMISSIBLE: YamlPipelineDocument = {
  state: { input: 'str', messages: 'list', summary: 'str' },
  entry_point: 'LLM_1',
  nodes: [{ id: 'LLM_1', type: 'llm', input: ['messages'], output: ['summary'], transition: 'END' }],
};

/** The same graph with the `summary` state variable deleted — the LLM node now writes nowhere. */
const INADMISSIBLE: YamlPipelineDocument = { ...ADMISSIBLE, state: { input: 'str', messages: 'list' } };

/** Renders the flag the Save button reads, so the assertions name the real gate. */
function SaveFlagProbe(): ReactNode {
  const form = useForm({ mode: 'onChange', defaultValues: {} });
  return (
    <FormProvider {...form}>
      <span data-testid="can-save">{String(form.formState.isValid)}</span>
      <GraphAdmissionGate />
    </FormProvider>
  );
}

function seedGraph(document: YamlPipelineDocument): void {
  usePipelineYamlStore.setState({ yamlCode: 'seeded', yamlJsonObject: document });
}

describe('GraphAdmissionGate', () => {
  beforeEach(() => {
    usePipelineYamlStore.setState({ yamlCode: '', yamlJsonObject: {} });
  });

  it('leaves Save available for an admissible graph, and shows no banner', async () => {
    seedGraph(ADMISSIBLE);
    const { getByTestId, queryByTestId } = renderWithTheme(<SaveFlagProbe />);

    await waitFor(() => expect(getByTestId('can-save')).toHaveTextContent('true'));
    expect(queryByTestId('graph-admission-gate')).not.toBeInTheDocument();
  });

  it('blocks Save and names the offending node when the graph is inadmissible', async () => {
    seedGraph(INADMISSIBLE);
    const { getByTestId } = renderWithTheme(<SaveFlagProbe />);

    await waitFor(() => expect(getByTestId('can-save')).toHaveTextContent('false'));
    expect(getByTestId('graph-admission-gate')).toHaveTextContent('LLM_1');
  });

  it('releases Save again once the graph is fixed', async () => {
    seedGraph(INADMISSIBLE);
    const { getByTestId, queryByTestId } = renderWithTheme(<SaveFlagProbe />);
    await waitFor(() => expect(getByTestId('can-save')).toHaveTextContent('false'));

    /*
     * The discriminator for a real bug in this gate's first shape:
     * react-hook-form's `clearErrors` does not recompute `isValid`
     * (7.83, `dist/index.esm.mjs:2724-2741` never calls `_setValid`), so
     * lifting the veto by clearing the error alone leaves Save disabled
     * forever — the user fixes the graph and can still never save it.
     */
    act(() => seedGraph(ADMISSIBLE));

    await waitFor(() => expect(getByTestId('can-save')).toHaveTextContent('true'));
    expect(queryByTestId('graph-admission-gate')).not.toBeInTheDocument();
  });

  it('does not block Save when the editor holds no graph at all', async () => {
    const { getByTestId } = renderWithTheme(<SaveFlagProbe />);

    // An unseeded editor is not an invalid pipeline. Gating here would block
    // saves that have nothing to do with the graph — see `useGraphAdmission.ts`.
    await waitFor(() => expect(getByTestId('can-save')).toHaveTextContent('true'));
  });

  it('does not throw with no FormProvider ancestor', () => {
    seedGraph(INADMISSIBLE);

    expect(() => renderWithTheme(<GraphAdmissionGate />)).not.toThrow();
  });

  it('withholds the banner when the configuration panel is collapsed, but still blocks Save', async () => {
    seedGraph(INADMISSIBLE);
    const Collapsed = (): ReactNode => {
      const form = useForm({ mode: 'onChange', defaultValues: {} });
      return (
        <FormProvider {...form}>
          <span data-testid="can-save">{String(form.formState.isValid)}</span>
          <GraphAdmissionGate summaryHidden />
        </FormProvider>
      );
    };
    const { getByTestId, queryByTestId } = renderWithTheme(<Collapsed />);

    await waitFor(() => expect(getByTestId('can-save')).toHaveTextContent('false'));
    expect(queryByTestId('graph-admission-gate')).not.toBeInTheDocument();
  });
});
