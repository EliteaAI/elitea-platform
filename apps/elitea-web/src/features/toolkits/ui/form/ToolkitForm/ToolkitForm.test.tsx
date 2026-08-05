import { act, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToolEvents } from '@/entities/toolkit';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { renderWithRouterSocketAndProject } from '../../../__tests__/testUtils';
import { eventEmitter } from '../../../lib/eventEmitter';

import type { ToolkitFormEditDetail, ToolkitFormProps, ToolkitValidationInjected } from './ToolkitForm';
import { ToolkitForm } from './ToolkitForm';

const TOOLKIT_TYPES_URL = '/api/v2/elitea_core/toolkits/prompt_lib/:projectId';
const CONFIGURATIONS_LIST_URL = '/api/v2/configurations/configurations/:projectId';
const CONFIGURATIONS_AVAILABLE_URL = '/api/v2/configurations/available/';

/**
 * `ToolkitForm.tsx` fires all three of these on mount (`useGetCurrentToolkitSchemas`,
 * `useConfigurationsList`, `useConfigurationsAsSchema` — see that file's own
 * module doc comment, redesign 4). `src/test/setup.ts` runs MSW with
 * `onUnhandledRequest: 'error'`, so every one needs a handler or the test
 * fails outright, not just produces a wrong result.
 */
function mockToolkitFormEndpoints(toolkitTypeSchemas: Record<string, unknown> = {}): void {
  server.use(
    http.get(TOOLKIT_TYPES_URL, () => HttpResponse.json(toolkitTypeSchemas)),
    http.get(CONFIGURATIONS_LIST_URL, () => HttpResponse.json({ items: [], total: 0, limit: 20, offset: 0 })),
    http.get(CONFIGURATIONS_AVAILABLE_URL, () => HttpResponse.json([])),
  );
}

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
});

afterEach(() => {
  resetGeneratedClient();
});

function baseProps(overrides: Partial<ToolkitFormProps> = {}): ToolkitFormProps {
  const editToolDetail: ToolkitFormEditDetail = { type: 'custom', name: 'My Tool', settings: {} };
  return {
    editToolDetail,
    onChangeToolDetail: vi.fn(),
    isEditing: true,
    projectId: 'proj-1',
    formValues: editToolDetail,
    formInitialValues: editToolDetail,
    onSave: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

describe('ToolkitForm', () => {
  it('hides the Form/Raw Json toggle for the custom toolkit type and renders ToolCustom', async () => {
    mockToolkitFormEndpoints();
    const { getByText, queryByText } = renderWithRouterSocketAndProject(
      <ToolkitForm {...baseProps()} />,
      'proj-1',
    );

    await waitFor(() => expect(getByText('JSON')).toBeInTheDocument());
    expect(queryByText('Form')).not.toBeInTheDocument();
    expect(queryByText('Raw Json')).not.toBeInTheDocument();
  });

  it('shows the Form/Raw Json toggle for a non-custom type once a schema object is resolved', async () => {
    mockToolkitFormEndpoints();
    const editToolDetail: ToolkitFormEditDetail = { type: 'some-other-type', name: 'x', settings: {} };
    const { getByText } = renderWithRouterSocketAndProject(
      <ToolkitForm {...baseProps({ editToolDetail, formValues: editToolDetail, formInitialValues: editToolDetail })} />,
      'proj-1',
    );

    await waitFor(() => expect(getByText('JSON')).toBeInTheDocument());
    expect(getByText('Form')).toBeInTheDocument();
    expect(getByText('Raw Json')).toBeInTheDocument();
  });

  it('hideOperationButtons unmounts ToolkitsOperationButtons: a ToolkitsUpdateToolkit event no longer reaches onSave', async () => {
    mockToolkitFormEndpoints();
    const onSave = vi.fn().mockResolvedValue({});
    renderWithRouterSocketAndProject(
      <ToolkitForm {...baseProps({ onSave, hideOperationButtons: true })} />,
      'proj-1',
    );
    await waitFor(() => expect(onSave).not.toHaveBeenCalled());

    act(() => {
      eventEmitter.emit(ToolEvents.ToolkitsUpdateToolkit);
    });

    // No listener is registered while hideOperationButtons is set — give any
    // (incorrect) async dispatch a turn to land before asserting the negative.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('the same ToolkitsUpdateToolkit event DOES reach onSave once ToolkitsOperationButtons is mounted (hideOperationButtons unset)', async () => {
    mockToolkitFormEndpoints();
    const onSave = vi.fn().mockResolvedValue({});
    renderWithRouterSocketAndProject(<ToolkitForm {...baseProps({ onSave })} />, 'proj-1');
    await waitFor(() => expect(onSave).not.toHaveBeenCalled());

    act(() => {
      eventEmitter.emit(ToolEvents.ToolkitsUpdateToolkit);
    });

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it('reports hasErrors: false once loaded when the toolkit has a name and no injected validation error', async () => {
    mockToolkitFormEndpoints();
    const onValidationStateChange = vi.fn();
    renderWithRouterSocketAndProject(
      <ToolkitForm {...baseProps({ onValidationStateChange })} />,
      'proj-1',
    );

    await waitFor(() => expect(onValidationStateChange).toHaveBeenCalledWith(expect.objectContaining({ hasErrors: false })));
  });

  it('reports hasErrors: true once an injected toolkitValidation error resolves to a server field error', async () => {
    mockToolkitFormEndpoints();
    const onValidationStateChange = vi.fn();
    const toolkitValidation: ToolkitValidationInjected = {
      isError: true,
      error: { data: { settings_errors: [{ msg: 'bad value', loc: ['settings', 'field1'] }] } },
      refetch: vi.fn(),
    };
    renderWithRouterSocketAndProject(
      <ToolkitForm {...baseProps({ onValidationStateChange, toolkitValidation })} />,
      'proj-1',
    );

    await waitFor(() => expect(onValidationStateChange).toHaveBeenCalledWith(expect.objectContaining({ hasErrors: true })));
  });

  it('syncs formValues.type from routeToolkitType via onSetFormField when no type is set yet', async () => {
    mockToolkitFormEndpoints();
    const onSetFormField = vi.fn();
    const editToolDetail: ToolkitFormEditDetail = { settings: {} };
    renderWithRouterSocketAndProject(
      <ToolkitForm
        {...baseProps({
          editToolDetail,
          formValues: {},
          formInitialValues: {},
          onSetFormField,
          routeToolkitType: 'jira',
        })}
      />,
      'proj-1',
    );

    await waitFor(() => expect(onSetFormField).toHaveBeenCalledWith('type', 'jira'));
  });

  it('does NOT sync the type when formValues already carries one', async () => {
    mockToolkitFormEndpoints();
    const onSetFormField = vi.fn();
    const editToolDetail: ToolkitFormEditDetail = { type: 'custom', settings: {} };
    renderWithRouterSocketAndProject(
      <ToolkitForm
        {...baseProps({
          editToolDetail,
          formValues: { type: 'confluence' },
          formInitialValues: { type: 'confluence' },
          onSetFormField,
          routeToolkitType: 'jira',
        })}
      />,
      'proj-1',
    );

    await waitFor(() => expect(onSetFormField).not.toHaveBeenCalledWith('type', expect.anything()));
  });

  it('renders a loading spinner (and nothing else) while editToolDetail.isLoadingConfigurations is set', async () => {
    mockToolkitFormEndpoints();
    const editToolDetail: ToolkitFormEditDetail = { type: 'custom', name: 'x', settings: {}, isLoadingConfigurations: true };
    const { getByRole, queryByText } = renderWithRouterSocketAndProject(
      <ToolkitForm {...baseProps({ editToolDetail, formValues: editToolDetail, formInitialValues: editToolDetail })} />,
      'proj-1',
    );

    await waitFor(() => expect(getByRole('progressbar')).toBeInTheDocument());
    expect(queryByText('JSON')).not.toBeInTheDocument();
  });
});
