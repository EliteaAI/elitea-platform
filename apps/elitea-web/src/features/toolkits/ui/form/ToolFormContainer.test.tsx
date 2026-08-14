import type { ReactNode } from 'react';
import { useState } from 'react';

import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { ToolFormContainer } from './ToolFormContainer';
import type { ToolFormContainerProperty } from './ToolFormContainer';

/**
 * The dict-owning parent `ToolFormContainer` is always mounted under — a
 * faithful copy of `IndexesTab.tsx`'s `IndexToolFormField` merge
 * (`{...currentValues, [changedKey]: value}`), which is the ONLY merge in
 * the app. #311 lives in that round trip, not in a single render: clearing
 * emits `undefined` for a key that then EXISTS in the dict, and the old
 * `resolveFieldValue` could not tell that from "never set". A test that
 * renders the container once, with a hand-written dict, cannot reach the
 * defect at all.
 */
function StatefulField({ property, onSave }: { readonly property: ToolFormContainerProperty; readonly onSave: (values: Readonly<Record<string, unknown>>) => void }): ReactNode {
  const [values, setValues] = useState<Readonly<Record<string, unknown>>>({});
  return (
    <>
      <ToolFormContainer
        fieldKey="output_format"
        property={property}
        toolInputVariables={values}
        schema={undefined}
        onChangeInputVariables={(fieldKey, value) => setValues({ ...values, [fieldKey]: value })}
      />
      <button
        type="button"
        onClick={() => onSave(values)}
      >
        Save
      </button>
    </>
  );
}

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

  /**
   * #311 — clearing a field that carries a schema `default` must persist the
   * cleared value. The old `resolveFieldValue` re-applied the default the
   * moment the emptied field's `undefined` came back through the dict, so the
   * field snapped back to `json` and `json` is what a save would carry.
   */
  it('keeps a field the user cleared empty, and saves the cleared value rather than the schema default', () => {
    const onSave = vi.fn();
    const { getByRole } = renderWithTheme(
      <StatefulField
        property={{ type: 'string', title: 'Output Format', default: 'json' }}
        onSave={onSave}
      />,
    );

    const input = getByRole('textbox');
    // The default DOES fill an untouched field — the fix must not cost this.
    expect(input).toBeVisible();
    expect(input).toHaveValue('json');

    fireEvent.change(input, { target: { value: '' } });

    expect(getByRole('textbox')).toBeVisible();
    expect(getByRole('textbox')).toHaveValue('');

    fireEvent.click(getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0]?.[0] as Readonly<Record<string, unknown>>;
    expect(Object.hasOwn(saved, 'output_format')).toBe(true);
    expect(saved['output_format']).toBeUndefined();
    expect(saved['output_format']).not.toBe('json');
  });

  it('re-applies the schema default only while the key is absent — a retyped value is not overwritten either', () => {
    const onSave = vi.fn();
    const { getByRole } = renderWithTheme(
      <StatefulField
        property={{ type: 'string', title: 'Output Format', default: 'json' }}
        onSave={onSave}
      />,
    );

    fireEvent.change(getByRole('textbox'), { target: { value: 'csv' } });
    expect(getByRole('textbox')).toHaveValue('csv');

    fireEvent.click(getByRole('button', { name: 'Save' }));
    const saved = onSave.mock.calls[0]?.[0] as Readonly<Record<string, unknown>> | undefined;
    expect(saved?.['output_format']).toBe('csv');
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
