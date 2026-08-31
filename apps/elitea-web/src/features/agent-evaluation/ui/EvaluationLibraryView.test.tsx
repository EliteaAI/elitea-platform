import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { PERMISSIONS } from '@/shared/lib/permissions';
import { server } from '@/test/setup';

import { renderWithEvaluationProviders } from '../__tests__/testUtils';
import { EVAL_ENGINE, EVAL_POLARITY, EVAL_SCALE_TYPE, EVAL_TIER } from '../model/types';
import { EvaluationLibraryView } from './EvaluationLibraryView';

const BASE = '/api/v2';

function permissionRows(names: readonly string[]) {
  return names.map((name) => ({ name, enabled: true }));
}

const ALL_EVALUATION_PERMISSIONS = [
  PERMISSIONS.evaluation.dimensionRead,
  PERMISSIONS.evaluation.dimensionCreate,
  PERMISSIONS.evaluation.dimensionUpdate,
  PERMISSIONS.evaluation.dimensionDelete,
];

function dimensionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '1',
    uuid: 'e0f1',
    name: 'Faithfulness',
    description: 'Grounded?',
    tier: EVAL_TIER.project,
    application_id: null,
    allowed_engines: [EVAL_ENGINE.ai],
    scale_type: EVAL_SCALE_TYPE.continuous,
    scale_min: 0,
    scale_max: 100,
    polarity: EVAL_POLARITY.higherBetter,
    default_weight: 1,
    default_target: null,
    default_target_operator: '',
    code: '',
    return_contract: '',
    ...overrides,
  };
}

function mockPermissions(names: readonly string[]): void {
  server.use(
    http.get(`${BASE}/auth/permissions/prompt_lib/:projectId`, () =>
      HttpResponse.json(permissionRows(names)),
    ),
  );
}

beforeEach(() => configureGeneratedClient({ baseUrl: BASE }));
afterEach(() => resetGeneratedClient());

describe('EvaluationLibraryView', () => {
  it('renders the library from a `{rows,total}` listing', async () => {
    mockPermissions(ALL_EVALUATION_PERMISSIONS);
    server.use(
      http.get(`${BASE}/elitea_core/eval_dimensions/prompt_lib/:projectId`, () =>
        HttpResponse.json({ rows: [dimensionRow()], total: 1 }),
      ),
    );

    renderWithEvaluationProviders(
      <EvaluationLibraryView
        projectId="1"
        applicationId={42}
      />,
    );

    expect(await screen.findByText('Faithfulness')).toBeInTheDocument();
  });

  /*
   * A viewer holds the read and none of the writes
   * (shared/0100_evaluation_dimension_permissions.sql). The controls must be
   * ABSENT rather than present-and-403: a button whose only outcome is a
   * refusal teaches the user the product is broken.
   */
  it('hides the write controls from a read-only caller', async () => {
    mockPermissions([PERMISSIONS.evaluation.dimensionRead]);
    server.use(
      http.get(`${BASE}/elitea_core/eval_dimensions/prompt_lib/:projectId`, () =>
        HttpResponse.json({ rows: [dimensionRow()], total: 1 }),
      ),
    );

    renderWithEvaluationProviders(
      <EvaluationLibraryView
        projectId="1"
        applicationId={42}
      />,
    );

    await screen.findByText('Faithfulness');
    expect(screen.queryByTestId('evaluation-dimension-edit-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('evaluation-dimension-delete-1')).not.toBeInTheDocument();
  });

  /*
   * With no read grant the tab must not ASK. A request that answers 403 and is
   * rendered as an error banner tells a viewer their product is broken when in
   * fact they simply may not author rubrics.
   */
  it('does not query at all without the read permission', async () => {
    mockPermissions([]);
    let asked = false;
    server.use(
      http.get(`${BASE}/elitea_core/eval_dimensions/prompt_lib/:projectId`, () => {
        asked = true;
        return HttpResponse.json({ rows: [], total: 0 });
      }),
    );

    renderWithEvaluationProviders(
      <EvaluationLibraryView
        projectId="1"
        applicationId={42}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('evaluation-library-view')).toBeInTheDocument();
    });
    expect(asked).toBe(false);
  });

  it('reports an empty library rather than rendering nothing', async () => {
    mockPermissions(ALL_EVALUATION_PERMISSIONS);
    server.use(
      http.get(`${BASE}/elitea_core/eval_dimensions/prompt_lib/:projectId`, () =>
        HttpResponse.json({ rows: [], total: 0 }),
      ),
    );

    renderWithEvaluationProviders(
      <EvaluationLibraryView
        projectId="1"
        applicationId={42}
      />,
    );

    expect(await screen.findByTestId('evaluation-library-empty')).toBeInTheDocument();
  });

  /*
   * THE READ-BACK, through the UI. Creating a dimension must make it appear in
   * the list without a reload — which is a claim about the query-key namespace
   * as much as about the request. A mutation that invalidates a namespace the
   * list does not read succeeds, refreshes nothing, and looks like a write that
   * did nothing.
   */
  it('shows a newly created dimension in the list without a reload', async () => {
    mockPermissions(ALL_EVALUATION_PERMISSIONS);
    const stored: ReturnType<typeof dimensionRow>[] = [];
    server.use(
      http.get(`${BASE}/elitea_core/eval_dimensions/prompt_lib/:projectId`, () =>
        HttpResponse.json({ rows: stored, total: stored.length }),
      ),
      http.post(`${BASE}/elitea_core/eval_dimensions/prompt_lib/:projectId`, async ({ request }) => {
        const body = (await request.json()) as { name: string };
        const created = dimensionRow({ name: body.name });
        stored.push(created);
        return HttpResponse.json(created, { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderWithEvaluationProviders(
      <EvaluationLibraryView
        projectId="1"
        applicationId={42}
      />,
    );

    await screen.findByTestId('evaluation-library-empty');
    await user.click(screen.getByRole('button', { name: 'New dimension' }));

    await user.type(await screen.findByLabelText('Name'), 'Faithfulness');

    // Polarity is deliberately unset in a new form; the dialog must refuse to
    // save until it is stated, and must SAY so.
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByTestId('dimension-editor-error')).toHaveTextContent(/polarity/i);
    expect(stored).toHaveLength(0);

    await user.click(screen.getByLabelText('Polarity'));
    await user.click(await screen.findByRole('option', { name: 'Higher is better' }));
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('Faithfulness')).toBeInTheDocument();
    expect(stored).toHaveLength(1);
  });
});
