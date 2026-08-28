import type { ReactElement } from 'react';

import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { renderWithTheme as renderWithThemeOnly } from '@/shared/ui/lib/testTheme';

import { ToolSection } from './ToolSection';
import type { ToolErrors } from './types';

const SCHEMA = {
  properties: {
    client_id: { title: 'Client ID', type: 'string' },
    client_secret: { title: 'Client Secret', type: 'string', secret: true },
    api_key: { title: 'API Key', type: 'string', secret: true },
  },
};

const SUBSECTIONS = [
  { name: 'OAuth', fields: ['client_id', 'client_secret'] },
  { name: 'ApiKeyAuth', fields: ['api_key'] },
];

function baseFormState(overrides: Partial<{ toolErrors: ToolErrors }> = {}) {
  return {
    toolErrors: overrides.toolErrors ?? {},
    showValidation: false,
    setToolErrors: vi.fn(),
  };
}

/**
 * #441 wired the secret field to the real secret list and permission list,
 * so a secret-kind field now runs two TanStack queries. `renderWithTheme`
 * supplies a theme only, so every render below adds a throwaway
 * `QueryClient`. No handler is registered on purpose: these tests assert the
 * field's own markup, not its data, and an unhandled request simply leaves
 * both queries empty. `SecretFieldInput.permission.test.tsx` owns the
 * data-dependent assertions.
 */
function renderWithTheme(ui: ReactElement): ReturnType<typeof renderWithThemeOnly> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithThemeOnly(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('ToolSection', () => {
  it('renders the section header and a radio option per subsection', () => {
    const { getByText, getByRole } = renderWithTheme(
      <ToolSection
        identity={{ sectionKey: 'auth', subsections: SUBSECTIONS, required: true, schema: SCHEMA }}
        formState={baseFormState()}
        settings={{}}
        editField={vi.fn()}
        handleInputChange={() => vi.fn()}
        setEditToolDetail={vi.fn()}
      />,
    );
    expect(getByText('Auth')).toBeInTheDocument();
    expect(getByRole('radio', { name: 'OAuth' })).toBeInTheDocument();
    expect(getByRole('radio', { name: 'ApiKeyAuth' })).toBeInTheDocument();
  });

  it('defaults to the subsection with the most matching non-null field values', () => {
    const { getByRole } = renderWithTheme(
      <ToolSection
        identity={{ sectionKey: 'auth', subsections: SUBSECTIONS, required: true, schema: SCHEMA }}
        formState={baseFormState()}
        settings={{ api_key: 'secret-value' }}
        editField={vi.fn()}
        handleInputChange={() => vi.fn()}
        setEditToolDetail={vi.fn()}
      />,
    );
    expect(getByRole('radio', { name: 'ApiKeyAuth' })).toBeChecked();
  });

  it('renders only the selected subsection\'s fields', () => {
    const { queryByText } = renderWithTheme(
      <ToolSection
        identity={{ sectionKey: 'auth', subsections: SUBSECTIONS, required: true, schema: SCHEMA }}
        formState={baseFormState()}
        settings={{ client_id: 'x' }}
        editField={vi.fn()}
        handleInputChange={() => vi.fn()}
        setEditToolDetail={vi.fn()}
      />,
    );
    expect(queryByText('Client ID')).toBeInTheDocument();
    expect(queryByText('API Key')).not.toBeInTheDocument();
  });

  it('switches subsections when a different radio option is picked', async () => {
    const user = userEvent.setup();
    const setEditToolDetail = vi.fn();
    const { getByRole, getByText } = renderWithTheme(
      <ToolSection
        identity={{ sectionKey: 'auth', subsections: SUBSECTIONS, required: true, schema: SCHEMA }}
        formState={baseFormState()}
        settings={{ client_id: 'x' }}
        editField={vi.fn()}
        handleInputChange={() => vi.fn()}
        setEditToolDetail={setEditToolDetail}
      />,
    );
    await user.click(getByRole('radio', { name: 'ApiKeyAuth' }));
    expect(getByText('API Key')).toBeInTheDocument();
    expect(setEditToolDetail).toHaveBeenCalled();
  });

  it('sorts secret fields before non-secret fields within a subsection', () => {
    const { container } = renderWithTheme(
      <ToolSection
        identity={{ sectionKey: 'auth', subsections: SUBSECTIONS, required: true, schema: SCHEMA }}
        formState={baseFormState()}
        settings={{ client_id: 'x' }}
        editField={vi.fn()}
        handleInputChange={() => vi.fn()}
        setEditToolDetail={vi.fn()}
      />,
    );
    const labels = Array.from(container.querySelectorAll('label')).map((el) => el.textContent);
    const secretIndex = labels.findIndex((label) => label?.includes('Client Secret'));
    const idIndex = labels.findIndex((label) => label?.includes('Client ID'));
    expect(secretIndex).toBeGreaterThanOrEqual(0);
    expect(secretIndex).toBeLessThan(idIndex);
  });

  it('shows an "Anonymous" option when the section is not required', () => {
    const { getByRole } = renderWithTheme(
      <ToolSection
        identity={{ sectionKey: 'auth', subsections: SUBSECTIONS, required: false, schema: SCHEMA }}
        formState={baseFormState()}
        settings={{}}
        editField={vi.fn()}
        handleInputChange={() => vi.fn()}
        setEditToolDetail={vi.fn()}
      />,
    );
    expect(getByRole('radio', { name: 'Anonymous' })).toBeInTheDocument();
  });

  it('restores previously-cached subsection values when switching back to it (ToolSection.jsx:140-150)', async () => {
    const user = userEvent.setup();
    const editField = vi.fn();
    const { getByRole } = renderWithTheme(
      <ToolSection
        identity={{ sectionKey: 'auth', subsections: SUBSECTIONS, required: true, schema: SCHEMA }}
        formState={baseFormState()}
        settings={{ client_id: 'cached-id', client_secret: 'cached-secret' }}
        editField={editField}
        handleInputChange={() => vi.fn()}
        setEditToolDetail={vi.fn()}
      />,
    );
    // Defaults to OAuth (most matching non-null fields); switch away, then back.
    await user.click(getByRole('radio', { name: 'ApiKeyAuth' }));
    editField.mockClear();
    await user.click(getByRole('radio', { name: 'OAuth' }));
    expect(editField).toHaveBeenCalledWith('settings.client_id', 'cached-id');
    expect(editField).toHaveBeenCalledWith('settings.client_secret', 'cached-secret');
  });

  it('renders DisabledAuthSection for a disableConfigFields "auth" section with a set configuration field (ToolSection.jsx:238-273)', () => {
    const schema = {
      properties: {
        client_id: { title: 'Client ID', type: 'string', configuration: true },
      },
    };
    const subsections = [{ name: 'OAuth', fields: ['client_id'] }];
    const { getByText } = renderWithTheme(
      <ToolSection
        identity={{ sectionKey: 'auth', subsections, required: true, schema }}
        formState={baseFormState()}
        settings={{ client_id: 'preset-value' }}
        editField={vi.fn()}
        handleInputChange={() => vi.fn()}
        setEditToolDetail={vi.fn()}
        visibility={{ disableConfigFields: true }}
      />,
    );
    expect(getByText('Auth')).toBeInTheDocument();
    expect(getByText('Client ID')).toBeInTheDocument();
  });

  it('renders nothing for a disableConfigFields section once every configured field is unset (ToolSection.jsx:233-235)', () => {
    const schema = {
      properties: {
        client_id: { title: 'Client ID', type: 'string', configuration: true },
      },
    };
    const subsections = [{ name: 'OAuth', fields: ['client_id'] }];
    const { container } = renderWithTheme(
      <ToolSection
        identity={{ sectionKey: 'auth', subsections, required: true, schema }}
        formState={baseFormState()}
        settings={{}}
        editField={vi.fn()}
        handleInputChange={() => vi.fn()}
        setEditToolDetail={vi.fn()}
        visibility={{ disableConfigFields: true }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('falls through to the normal (non-disabled) render for a disableConfigFields section that is not "auth"', () => {
    // Ported behaviour, not a design choice of this port: the baseline's
    // `if (disableConfigFields) { ...; if (sectionKey === 'auth') { return
    // (...) } }` only short-circuits for the literal `auth` section key —
    // any other section key falls through to the ordinary radio+fields
    // render below (`ToolSection.jsx:219-274`).
    const { getByText, getByRole } = renderWithTheme(
      <ToolSection
        identity={{ sectionKey: 'other', subsections: SUBSECTIONS, required: true, schema: SCHEMA }}
        formState={baseFormState()}
        settings={{}}
        editField={vi.fn()}
        handleInputChange={() => vi.fn()}
        setEditToolDetail={vi.fn()}
        visibility={{ disableConfigFields: true }}
      />,
    );
    expect(getByText('Other')).toBeInTheDocument();
    expect(getByRole('radio', { name: 'OAuth' })).toBeInTheDocument();
  });
});
