import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { ToolFormContainer } from './ToolFormContainer';
import type { ToolFormContainerProperty } from './ToolFormContainer';

/** jsdom has no `ResizeObserver` — `AnyOfPatternField`'s array-of-values editor mounts a `ResizableCodeMirrorEditor` (`shared/ui`), which needs one. Same stub `CategorySection.test.tsx` already documents for this exact gap. */
class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
}

describe('ToolFormContainer', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a CommonStringField for a plain string property, labelled by property.title', () => {
    const { getByText } = renderWithTheme(
      <ToolFormContainer
        fieldKey="repo_name"
        property={{ type: 'string', title: 'Repository Name' }}
        toolInputVariables={{}}
        schema={undefined}
        onChangeInputVariables={vi.fn()}
      />,
    );
    expect(getByText('Repository Name')).toBeInTheDocument();
  });

  it('falls back to fieldKey as the label when property.title is absent', () => {
    const { getByText } = renderWithTheme(
      <ToolFormContainer
        fieldKey="repo_name"
        property={{ type: 'string' }}
        toolInputVariables={{}}
        schema={undefined}
        onChangeInputVariables={vi.fn()}
      />,
    );
    expect(getByText('repo_name')).toBeInTheDocument();
  });

  it('renders a CommonBooleanField for a boolean property and forwards toggles as (fieldKey, value)', () => {
    const onChange = vi.fn();
    const { getByRole } = renderWithTheme(
      <ToolFormContainer
        fieldKey="enabled"
        property={{ type: 'boolean', title: 'Enabled' }}
        toolInputVariables={{ enabled: false }}
        schema={undefined}
        onChangeInputVariables={onChange}
      />,
    );
    fireEvent.click(getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith('enabled', true);
  });

  it('defaults to property.default when the field is absent from toolInputVariables', () => {
    const { getByRole } = renderWithTheme(
      <ToolFormContainer
        fieldKey="enabled"
        property={{ type: 'boolean', title: 'Enabled', default: true }}
        toolInputVariables={{}}
        schema={undefined}
        onChangeInputVariables={vi.fn()}
      />,
    );
    expect(getByRole('checkbox')).toBeChecked();
  });

  it('marks a field required when schema.required includes fieldKey', () => {
    const { getByText } = renderWithTheme(
      <ToolFormContainer
        fieldKey="repo_name"
        property={{ type: 'string', title: 'Repository Name' }}
        toolInputVariables={{}}
        schema={{ required: ['repo_name'] }}
        onChangeInputVariables={vi.fn()}
      />,
    );
    expect(getByText('Repository Name *')).toBeInTheDocument();
  });

  it('renders a SecretInputField (masked) for a format:"password" property, ahead of the type dispatch', () => {
    const { getByLabelText } = renderWithTheme(
      <ToolFormContainer
        fieldKey="api_key"
        property={{ type: 'string', title: 'API Key', format: 'password' }}
        toolInputVariables={{ api_key: 'shh' }}
        schema={undefined}
        onChangeInputVariables={vi.fn()}
      />,
    );
    const input = getByLabelText('API Key') as HTMLInputElement;
    expect(input.type).toBe('password');
  });

  it('renders a SecretInputField for a fieldKey matching a secret-ish pattern even without format:"password"', () => {
    const { getByLabelText } = renderWithTheme(
      <ToolFormContainer
        fieldKey="access_token"
        property={{ type: 'string', title: 'Access Token' }}
        toolInputVariables={{}}
        schema={undefined}
        onChangeInputVariables={vi.fn()}
      />,
    );
    const input = getByLabelText('Access Token') as HTMLInputElement;
    expect(input.type).toBe('password');
  });

  it('renders an AnyOfPatternField (ahead of the secret/type dispatch) for an anyOf array-typed property', () => {
    const property: ToolFormContainerProperty = {
      title: 'Whitelist',
      anyOf: [{ type: 'array' }, { type: 'null' }],
    };
    const { getByText } = renderWithTheme(
      <ToolFormContainer
        fieldKey="whitelist"
        property={property}
        toolInputVariables={{}}
        schema={undefined}
        onChangeInputVariables={vi.fn()}
      />,
    );
    expect(getByText('Whitelist')).toBeInTheDocument();
  });

  it('returns null for a hidden property (falls through secret/array checks first)', () => {
    const { container } = renderWithTheme(
      <ToolFormContainer
        fieldKey="internal_flag"
        property={{ type: 'string', title: 'Internal', hidden: true }}
        toolInputVariables={{}}
        schema={undefined}
        onChangeInputVariables={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('returns null when visible_when does not match the referenced field value', () => {
    const { container } = renderWithTheme(
      <ToolFormContainer
        fieldKey="sub_field"
        property={{ type: 'string', title: 'Sub field', visible_when: { field: 'mode', value: 'advanced' } }}
        toolInputVariables={{ mode: 'basic' }}
        schema={undefined}
        onChangeInputVariables={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders when visible_when matches the referenced field value (case-insensitively for strings)', () => {
    const { getByText } = renderWithTheme(
      <ToolFormContainer
        fieldKey="sub_field"
        property={{ type: 'string', title: 'Sub field', visible_when: { field: 'mode', value: 'Advanced' } }}
        toolInputVariables={{ mode: 'advanced' }}
        schema={undefined}
        onChangeInputVariables={vi.fn()}
      />,
    );
    expect(getByText('Sub field')).toBeInTheDocument();
  });

  it('resolves the Optional-type (anyOf) branch type when property.type is absent', () => {
    const property: ToolFormContainerProperty = {
      title: 'Retries',
      anyOf: [{ type: 'integer' }, { type: 'null' }],
    };
    const { getByText } = renderWithTheme(
      <ToolFormContainer
        fieldKey="retries"
        property={property}
        toolInputVariables={{}}
        schema={undefined}
        onChangeInputVariables={vi.fn()}
      />,
    );
    expect(getByText('Retries')).toBeInTheDocument();
  });
});
