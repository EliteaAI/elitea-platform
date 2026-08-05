import { fireEvent, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { renderWithRouterSocketAndProject } from '../../__tests__/testUtils';
import { NameDescriptionInput } from './NameDescriptionInput';

const TOOLKIT_TYPES_URL = '/api/v2/elitea_core/toolkits/prompt_lib/:projectId';

beforeEach(() => {
  configureGeneratedClient({ baseUrl: '/api/v2' });
  server.use(http.get(TOOLKIT_TYPES_URL, () => HttpResponse.json({})));
});

afterEach(() => {
  resetGeneratedClient();
});

describe('NameDescriptionInput', () => {
  it('returns null when showOnlyConfigurationFields is set', async () => {
    const { container } = renderWithRouterSocketAndProject(
      <NameDescriptionInput
        type="github"
        name="my-github"
        toolkitName={undefined}
        description=""
        editField={vi.fn()}
        showOnlyConfigurationFields
      />,
      'proj-1',
    );
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('renders the name and description fields for a type with no toolkit_name schema property (both required)', async () => {
    const { getByLabelText } = renderWithRouterSocketAndProject(
      <NameDescriptionInput
        type="github"
        name="my-github"
        toolkitName={undefined}
        description="a description"
        editField={vi.fn()}
      />,
      'proj-1',
    );
    // `{ exact: false }`: a required field's `<label>` (`StyledInputEnhancer`,
    // unit S1-F) includes MUI's own `Mui-required` asterisk `<span>` as a
    // label CHILD — `aria-hidden="true"` correctly excludes it from the
    // real accessible name, but `getByLabelText`'s default matcher reads the
    // label's raw `textContent` (asterisk text included), so an exact
    // `'Toolkit Name'` string never matches a required field's label
    // (`'Toolkit Name *'`). `nameIsRequired` defaults `true` for any type
    // with no registered schema (`useToolkitNameProp.hooks.ts`), so
    // `github` here always renders the asterisk.
    await waitFor(() => expect(getByLabelText('Toolkit Name', { exact: false })).toHaveValue('my-github'));
    expect(getByLabelText('Description')).toHaveValue('a description');
  });

  it('calls editField("name", value) when the name input changes', async () => {
    const editField = vi.fn();
    const { getByLabelText } = renderWithRouterSocketAndProject(
      <NameDescriptionInput
        type="github"
        name="old-name"
        toolkitName={undefined}
        description=""
        editField={editField}
      />,
      'proj-1',
    );
    // See the previous test's own comment for why `{ exact: false }` is needed here.
    await waitFor(() => expect(getByLabelText('Toolkit Name', { exact: false })).toBeInTheDocument());
    fireEvent.change(getByLabelText('Toolkit Name', { exact: false }), { target: { value: 'new-name' } });
    expect(editField).toHaveBeenCalledWith('name', 'new-name');
  });

  it('calls editField("description", value) when the description input changes', async () => {
    const editField = vi.fn();
    const { getByLabelText } = renderWithRouterSocketAndProject(
      <NameDescriptionInput
        type="github"
        name="my-github"
        toolkitName={undefined}
        description=""
        editField={editField}
      />,
      'proj-1',
    );
    await waitFor(() => expect(getByLabelText('Description')).toBeInTheDocument());
    fireEvent.change(getByLabelText('Description'), { target: { value: 'new description' } });
    expect(editField).toHaveBeenCalledWith('description', 'new description');
  });

  it('shows the required-field error only when showValidation is true and toolErrors flags the field', async () => {
    const { getByLabelText } = renderWithRouterSocketAndProject(
      <NameDescriptionInput
        type="github"
        name=""
        toolkitName={undefined}
        description=""
        editField={vi.fn()}
        showValidation
        toolErrors={{ name: true }}
      />,
      'proj-1',
    );
    // See the "renders the name and description fields..." test's own comment for why `{ exact: false }` is needed here.
    await waitFor(() => expect(getByLabelText('Toolkit Name', { exact: false })).toHaveAttribute('aria-invalid', 'true'));
  });

  it('hides the name input when hideNameInput is set and the field is not force-shown', async () => {
    const { queryByLabelText, getByLabelText } = renderWithRouterSocketAndProject(
      <NameDescriptionInput
        type="github"
        name="my-github"
        toolkitName={undefined}
        description=""
        editField={vi.fn()}
        hideNameInput
      />,
      'proj-1',
    );
    await waitFor(() => expect(getByLabelText('Description')).toBeInTheDocument());
    expect(queryByLabelText('Toolkit Name')).not.toBeInTheDocument();
  });

  it('renders the toolkit icon glyph when showToolkitIcon is set', async () => {
    const { getByTestId } = renderWithRouterSocketAndProject(
      <NameDescriptionInput
        type="github"
        name="my-github"
        toolkitName={undefined}
        description=""
        editField={vi.fn()}
        showToolkitIcon
      />,
      'proj-1',
    );
    await waitFor(() => expect(getByTestId('entity-icon')).toBeInTheDocument());
  });

  it('hides the description field when the type has a schema-flagged toolkit_name property (name-only mode)', async () => {
    // A type with a `toolkit_name`-flagged property and `nameIsRequired`
    // false is, per the baseline's own `isToolNameVisible` formula
    // (`NameDescriptionInput.jsx:51-52`: `nameIsRequired || !toolkitNameProp`,
    // faithfully ported above), one whose "name" is normally entered via
    // that dedicated schema field elsewhere in the type-specific form (e.g.
    // an MCP server's own URL/name field), not this generic component's own
    // name box — so this component hides ITS OWN name box by default for
    // this exact combination. A real caller that still wants THIS box to
    // show (and reflect `toolkitName`, read-only) sets `showNameFieldForcedly`
    // explicitly — `ToolBase.render.tsx`'s `presentation.showNameFieldForcedly`
    // plumbs exactly this caller-controlled override through (verified: that
    // sibling A4c file, `../ToolBase/ToolBase.render.tsx`, forwards it as its
    // own `NameDescriptionInput` slot prop, confirming this is a real,
    // caller-selected mode, not always-on).
    server.use(
      http.get(TOOLKIT_TYPES_URL, () => HttpResponse.json({ mcp: { properties: { url: { toolkit_name: true } }, name_required: false } })),
    );
    const { queryByLabelText, getByLabelText } = renderWithRouterSocketAndProject(
      <NameDescriptionInput
        type="mcp"
        name={undefined}
        toolkitName="my-server"
        description=""
        editField={vi.fn()}
        showNameFieldForcedly
      />,
      'proj-1',
    );
    await waitFor(() => expect(getByLabelText('Toolkit Name')).toHaveValue('my-server'));
    expect(queryByLabelText('Description')).not.toBeInTheDocument();
    expect(getByLabelText('Toolkit Name')).toBeDisabled();
  });
});
