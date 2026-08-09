import { QueryClient } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useForm } from 'react-hook-form';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ApplicationCreationInput } from '@/entities/application-form';
import { getGetApplicationQueryKey } from '@/shared/api/generated/applications/applications';
import type { ApplicationVersionDetail, ApplicationVersionSummary } from '@/shared/api/generated/model';

import { renderAgentsRoute } from '../__tests__/testRouter';

import { useEditApplicationVersionControls } from './useEditApplicationVersionControls';

/**
 * Driven through the unit's REAL router fixture rather than a mocked
 * `useNavigate` — R-M1 (`elitea/no-vi-mock`) allows only the MSW network
 * boundary and the socket double to be substituted, and a mocked navigate
 * would in any case only prove the hook called a function, not that the
 * route it names resolves. Asserting `router.state.location.pathname` proves
 * the latter.
 */
const versions: readonly ApplicationVersionSummary[] = [
  // Ids arrive from the API as strings ("numeric id serialized as string").
  { id: '1', name: 'base', status: 'draft', agent_type: 'classic', created_at: '2026-01-01T00:00:00Z' },
  { id: '2', name: 'v1', status: 'draft', agent_type: 'classic', created_at: '2026-01-02T00:00:00Z' },
];

const activeVersion = {
  id: '1',
  application_id: '42',
  name: 'base',
  status: 'draft',
  agent_type: 'classic',
  instructions: 'be helpful',
  welcome_message: 'hi',
  variables: [{ name: 'k', value: 'v' }],
} as unknown as ApplicationVersionDetail;

interface ProbeProps {
  readonly starters: readonly string[];
  readonly isReadOnly: boolean;
  readonly isFetching: boolean;
  readonly applicationId: number | undefined;
  readonly version: ApplicationVersionDetail | undefined;
}

function Probe({ starters, isReadOnly, isFetching, applicationId, version }: ProbeProps) {
  const form = useForm<ApplicationCreationInput>({
    values: { name: 'a', description: 'b', version_details: { conversation_starters: [...starters] } },
  });
  const state = useEditApplicationVersionControls({
    projectId: '9',
    applicationId,
    tab: 'my',
    versions,
    activeVersion: version,
    control: form.control,
    isReadOnly,
    isFetching,
  });
  return (
    <div>
      <span data-testid="options">{JSON.stringify(state.versionOptions)}</span>
      <span data-testid="body">{JSON.stringify(state.versionBody)}</span>
      <span data-testid="active">{String(state.activeVersionId)}</span>
      <span data-testid="can-save">{String(state.canSaveNewVersion)}</span>
      <span data-testid="show">{String(state.showVersionControls)}</span>
      <span data-testid="id-text">{`[${state.applicationIdText}]`}</span>
      <button
        data-testid="select"
        onClick={() => state.handleSelectVersion({ id: 2, name: 'v1' })}
      >
        select
      </button>
      <button
        data-testid="saved"
        onClick={() => state.handleNewVersionSaved({ id: '7' } as ApplicationVersionDetail)}
      >
        saved
      </button>
    </div>
  );
}

function renderProbe(overrides: Partial<ProbeProps> = {}, queryClient?: QueryClient) {
  const props: ProbeProps = {
    starters: ['start here'],
    isReadOnly: false,
    isFetching: false,
    applicationId: 42,
    version: activeVersion,
    ...overrides,
  };
  return renderAgentsRoute(<Probe {...props} />, '/agents/my/42', {
    projectId: '9',
    ...(queryClient === undefined ? {} : { queryClient }),
  });
}

let queryClient: QueryClient;

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});

describe('useEditApplicationVersionControls', () => {
  it("narrows the API's string version ids to the numbers the selector compares against", async () => {
    const { findByTestId, getByTestId } = renderProbe();
    expect(JSON.parse((await findByTestId('options')).textContent ?? '')).toEqual([
      { id: 1, name: 'base', created_at: '2026-01-01T00:00:00Z', status: 'draft' },
      { id: 2, name: 'v1', created_at: '2026-01-02T00:00:00Z', status: 'draft' },
    ]);
    expect(getByTestId('active').textContent).toBe('1');
  });

  it('switches version by NAVIGATING to the :version route', async () => {
    const { findByTestId, router } = renderProbe();

    await userEvent.click(await findByTestId('select'));

    await waitFor(() => expect(router.state.location.pathname).toBe('/agents/my/42/2'));
  });

  it('clones the LIVE form starters onto a new version, not the saved ones', async () => {
    const { findByTestId } = renderProbe({ starters: ['typed but unsaved'] });
    expect(JSON.parse((await findByTestId('body')).textContent ?? '')).toEqual({
      agent_type: 'classic',
      instructions: 'be helpful',
      welcome_message: 'hi',
      conversation_starters: ['typed but unsaved'],
      variables: [{ name: 'k', value: 'v' }],
    });
  });

  it('invalidates the application detail and navigates onto a newly created version', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { findByTestId, router } = renderProbe({}, queryClient);

    await userEvent.click(await findByTestId('saved'));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: getGetApplicationQueryKey('9', 42) });
    await waitFor(() => expect(router.state.location.pathname).toBe('/agents/my/42/7'));
  });

  it('withholds "Save As Version" from a read-only viewer', async () => {
    const { findByTestId } = renderProbe({ isReadOnly: true });
    expect((await findByTestId('can-save')).textContent).toBe('false');
  });

  it('offers "Save As Version" to an owner viewing a resolved version', async () => {
    const { findByTestId } = renderProbe();
    expect((await findByTestId('can-save')).textContent).toBe('true');
  });

  it('withholds "Save As Version" until an active version has resolved', async () => {
    const { findByTestId, getByTestId } = renderProbe({ version: undefined });
    expect((await findByTestId('can-save')).textContent).toBe('false');
    expect(JSON.parse(getByTestId('body').textContent ?? '')).toEqual({});
  });

  it('hides the whole bar while the detail is still in flight', async () => {
    const { findByTestId } = renderProbe({ isFetching: true });
    expect((await findByTestId('show')).textContent).toBe('false');
  });

  it('hides the bar and never navigates when there is no agent id', async () => {
    const { findByTestId, getByTestId, router } = renderProbe({ applicationId: undefined });
    expect((await findByTestId('show')).textContent).toBe('false');
    expect(getByTestId('id-text').textContent).toBe('[]');

    await userEvent.click(getByTestId('select'));
    expect(router.state.location.pathname).toBe('/agents/my/42');
  });
});
