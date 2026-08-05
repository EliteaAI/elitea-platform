import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router';
import { act, render, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { SocketClientContext } from '@/shared/api/socket/client';
import { createTestSocketClient } from '@/shared/api/socket/testing';
import { server } from '@/test/setup';

import { createTestQueryClient } from '../../../__tests__/testUtils';

import { useToolkitFormCore } from './ToolkitForm.core.hooks';
import type { CoreState } from './ToolkitForm.core.hooks';
import type { ResolvedToolkitFormProps } from './ToolkitForm.types';

const TOOLKIT_TYPES_URL = '/api/v2/elitea_core/toolkits/prompt_lib/:projectId';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
  server.use(http.get(TOOLKIT_TYPES_URL, () => HttpResponse.json({})));
});

afterEach(() => {
  resetGeneratedClient();
});

function baseProps(overrides: Partial<ResolvedToolkitFormProps> = {}): ResolvedToolkitFormProps {
  const editToolDetail = { type: 'github', settings: { embedding_model: 'old-model' } };
  return {
    editToolDetail,
    onChangeToolDetail: vi.fn(),
    isEditing: true,
    hasNotSavedCredentials: false,
    isViewToggleVisible: true,
    hideConfigurationNameInput: false,
    showOnlyRequiredFields: false,
    showOnlyConfigurationFields: false,
    showNameFieldForcedly: false,
    showToolkitIcon: false,
    hideNameDescriptionInput: false,
    hideNameInput: false,
    hideOperationButtons: false,
    forceCustomView: false,
    isTeamProject: false,
    projectId: 'proj-1',
    formValues: editToolDetail,
    formInitialValues: editToolDetail,
    onSave: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

/**
 * Mounts `useToolkitFormCore` under a real router root context AND a real
 * socket client — the hook's own `useGetCurrentToolkitSchemas` call bottoms
 * out at both (`useSelectedProjectId`/`useSocketClient`), same as
 * `useGetCurrentToolkitSchemas.hooks.test.tsx`'s own `renderToolkitSchemas`
 * harness. Not reused from `../../../__tests__/testUtils.tsx` because that
 * file's `renderHookWithRouterAndProject` has no Socket provider, and this
 * file is outside this fix's editable scope (STRICT file-scope fence).
 */
function renderCore(props: ResolvedToolkitFormProps): { readonly box: { current: CoreState | undefined } } {
  const box: { current: CoreState | undefined } = { current: undefined };

  function ProbeComponent() {
    box.current = useToolkitFormCore(props);
    return null;
  }

  function RootComponent() {
    return (
      <SocketClientContext.Provider value={createTestSocketClient()}>
        <ProbeComponent />
      </SocketClientContext.Provider>
    );
  }

  const queryClient = createTestQueryClient();
  const rootRoute = createRootRoute({ component: RootComponent });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { auth: { getSelectedProjectId: () => props.projectId } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );

  return { box };
}

describe('useToolkitFormCore editField', () => {
  /**
   * [R1 regression] Baseline: `ToolkitForm.jsx:286-291` — when a child
   * selector auto-selects a fallback value on the user's behalf (`options:
   * { isAutoSelect: true }`), `editField` also calls Formik's own
   * `resetForm({ values: updatedValues })` so the form's OWN initial values
   * move to match, and the auto-correction never reads as a user edit. This
   * app has no ambient Formik context, so the explicit `onResetForm` prop is
   * the equivalent hook a caller wires up. Before this fix, `editField`
   * dropped the whole branch — `onResetForm` was never even destructured
   * from props, let alone called — so this assertion fails against the
   * pre-fix code (confirmed by reverting the fix locally and re-running:
   * `onResetForm` stays uncalled) and passes once the branch is restored.
   */
  it('calls onResetForm with the auto-selected value merged into formValues when options.isAutoSelect is true', async () => {
    const onChangeToolDetail = vi.fn();
    const onResetForm = vi.fn();
    const props = baseProps({ onChangeToolDetail, onResetForm });
    const { box } = renderCore(props);

    await waitFor(() => expect(box.current).toBeDefined());

    await act(async () => {
      await box.current?.editField('settings.embedding_model', 'new-model', undefined, { isAutoSelect: true });
    });

    expect(onResetForm).toHaveBeenCalledTimes(1);
    expect(onResetForm).toHaveBeenCalledWith({ type: 'github', settings: { embedding_model: 'new-model' } });
    // The real field change still goes through `onChangeToolDetail`, options forwarded unchanged.
    expect(onChangeToolDetail).toHaveBeenCalledWith(expect.any(Function), { isAutoSelect: true });
  });

  it('does not call onResetForm for a normal user edit (no isAutoSelect option)', async () => {
    const onResetForm = vi.fn();
    const props = baseProps({ onResetForm });
    const { box } = renderCore(props);

    await waitFor(() => expect(box.current).toBeDefined());

    await act(async () => {
      await box.current?.editField('settings.embedding_model', 'new-model');
    });

    expect(onResetForm).not.toHaveBeenCalled();
  });

  it('does not throw when onResetForm is not supplied, even with isAutoSelect: true', async () => {
    const props = baseProps({ onResetForm: undefined });
    const { box } = renderCore(props);

    await waitFor(() => expect(box.current).toBeDefined());

    await expect(
      act(async () => {
        await box.current?.editField('settings.embedding_model', 'new-model', undefined, { isAutoSelect: true });
      }),
    ).resolves.not.toThrow();
  });
});
