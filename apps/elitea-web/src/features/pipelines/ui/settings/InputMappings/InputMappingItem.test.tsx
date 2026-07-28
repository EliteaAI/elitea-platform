import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';
import { InputMappingItem } from './InputMappingItem';

describe('InputMappingItem', () => {
  it('renders the variable name as a heading chip', () => {
    const { getByText } = renderWithTheme(
      <InputMappingItem
        variableName="My Variable"
        type="fixed"
        dataType="string"
        value=""
        enumList={undefined}
        variable="my_variable"
        onChangeMapping={vi.fn()}
        defaultValues={{}}
        mappingInfo={{}}
      />,
    );
    expect(getByText('My Variable')).toBeInTheDocument();
  });

  it('renders an info tooltip button when a tooltip string is given', () => {
    const { getByRole } = renderWithTheme(
      <InputMappingItem
        variableName="My Variable"
        type="fixed"
        dataType="string"
        value=""
        enumList={undefined}
        variable="my_variable"
        onChangeMapping={vi.fn()}
        tooltip="Helpful description"
        defaultValues={{}}
        mappingInfo={{}}
      />,
    );
    expect(getByRole('button', { name: 'Helpful description' })).toBeInTheDocument();
  });

  it('renders a boolean checkbox for a fixed boolean mapping and reports the toggle', async () => {
    const user = userEvent.setup();
    const onChangeMapping = vi.fn();
    const { getByRole } = renderWithTheme(
      <InputMappingItem
        variableName="Flag"
        type="fixed"
        dataType="boolean"
        value={false}
        enumList={undefined}
        variable="flag"
        onChangeMapping={onChangeMapping}
        defaultValues={{}}
        mappingInfo={{}}
      />,
    );
    await user.click(getByRole('checkbox'));
    expect(onChangeMapping).toHaveBeenCalledWith('flag', { type: 'fixed', value: true }, 'boolean');
  });

  it('renders a text field for a fixed string mapping and reports edits', async () => {
    const user = userEvent.setup();
    const onChangeMapping = vi.fn();
    const { getByRole } = renderWithTheme(
      <InputMappingItem
        variableName="Name"
        type="fixed"
        dataType="string"
        value="hello"
        enumList={undefined}
        variable="name"
        onChangeMapping={onChangeMapping}
        defaultValues={{}}
        mappingInfo={{}}
      />,
    );
    const input = getByRole('textbox');
    await user.type(input, '!');
    expect(onChangeMapping).toHaveBeenCalledWith('name', { type: 'fixed', value: 'hello!' }, 'string');
  });

  it('parses number input for an integer mapping', async () => {
    const user = userEvent.setup();
    const onChangeMapping = vi.fn();
    const { getByRole } = renderWithTheme(
      <InputMappingItem
        variableName="Count"
        type="fixed"
        dataType="integer"
        value={1}
        enumList={undefined}
        variable="count"
        onChangeMapping={onChangeMapping}
        defaultValues={{}}
        mappingInfo={{}}
      />,
    );
    // Appends onto the existing value rather than `clear()`-then-retype:
    // this component never feeds `onChangeMapping`'s (mocked, no-op) result
    // back into a new `value` prop, so it never re-renders mid-sequence —
    // `user.clear()` immediately followed by `user.type()` on a
    // `type="number"` input is a known source of jsdom/user-event
    // intermediate-state flakiness independent of this component's own
    // logic; appending a single digit onto an already-rendered value avoids
    // it entirely while still exercising the same `onNumberInput` parsing.
    const input = getByRole('spinbutton');
    await user.type(input, '2');
    expect(onChangeMapping).toHaveBeenLastCalledWith('count', { type: 'fixed', value: 12 }, 'integer');
  });

  it('renders a single-value enum select and reports the selection', async () => {
    const user = userEvent.setup();
    const onChangeMapping = vi.fn();
    const { getByRole, findByRole } = renderWithTheme(
      <InputMappingItem
        variableName="Mode"
        type="fixed"
        dataType="string"
        value="a"
        enumList={['a', 'b']}
        variable="mode"
        onChangeMapping={onChangeMapping}
        defaultValues={{}}
        mappingInfo={{}}
      />,
    );
    const combos = getByRole('combobox', { name: /select one option/i });
    await user.click(combos);
    await user.click(await findByRole('option', { name: 'b' }));
    expect(onChangeMapping).toHaveBeenCalledWith('mode', { type: 'fixed', value: 'b', enum: ['a', 'b'] }, 'string');
  });

  it('renders a multi-value enum select for an array dataType and reports the selection', async () => {
    const user = userEvent.setup();
    const onChangeMapping = vi.fn();
    const { getAllByRole, findByRole } = renderWithTheme(
      <InputMappingItem
        variableName="Tags"
        type="fixed"
        dataType="array"
        value={['a']}
        enumList={['a', 'b']}
        variable="tags"
        onChangeMapping={onChangeMapping}
        defaultValues={{}}
        mappingInfo={{}}
      />,
    );
    // Two comboboxes render here: the Type selector, then the multi-value
    // enum select — index 1 is the latter (DOM order).
    const comboboxes = getAllByRole('combobox');
    const multiSelect = comboboxes[1];
    if (!multiSelect) throw new Error('multi-select combobox not found');
    await user.click(multiSelect);
    await user.click(await findByRole('option', { name: 'b' }));
    expect(onChangeMapping).toHaveBeenCalledWith('tags', { type: 'fixed', value: ['a', 'b'], enum: ['a', 'b'] }, 'array');
  });

  it('falls back to a state-variable select when the type is "variable" with no enum', async () => {
    const user = userEvent.setup();
    const onChangeMapping = vi.fn();
    const { getByRole, findByRole } = renderWithTheme(
      <InputMappingItem
        variableName="Source"
        type="variable"
        dataType="string"
        value="input"
        enumList={undefined}
        variable="source"
        onChangeMapping={onChangeMapping}
        defaultValues={{}}
        mappingInfo={{}}
      />,
    );
    const combos = getByRole('combobox', { name: /select one option/i });
    await user.click(combos);
    await user.click(await findByRole('option', { name: 'messages' }));
    expect(onChangeMapping).toHaveBeenCalledWith('source', { type: 'variable', value: 'messages' }, 'string');
  });

  it('switches type from fstring to fixed while preserving the value', async () => {
    const user = userEvent.setup();
    const onChangeMapping = vi.fn();
    const { getByRole, findByRole } = renderWithTheme(
      <InputMappingItem
        variableName="Prompt"
        type="fstring"
        dataType="string"
        value="hello {input}"
        enumList={undefined}
        variable="prompt"
        onChangeMapping={onChangeMapping}
        defaultValues={{}}
        mappingInfo={{}}
      />,
    );
    const typeSelect = getByRole('combobox', { name: 'Type' });
    await user.click(typeSelect);
    await user.click(await findByRole('option', { name: 'Fixed' }));
    expect(onChangeMapping).toHaveBeenCalledWith('prompt', { type: 'fixed', value: 'hello {input}' }, 'string');
  });

  it('defaults to the first available state variable when switching to the "variable" type', async () => {
    // `FlowEditorHelpers.getEnumList('variable', ..., inputOptions)` returns
    // `inputOptions` itself (every state-variable name IS the enum for a
    // `variable`-typed mapping) — so `getInputMappingDefaultValue` picks
    // `enumList[0]` (the first available state variable, `'input'` here),
    // NOT `defaultValues[key]` (`defaultValues` is only consulted when the
    // computed enum list is empty). `defaultValues` is still passed, to
    // prove it is genuinely NOT what wins here.
    const user = userEvent.setup();
    const onChangeMapping = vi.fn();
    const { getByRole, findByRole } = renderWithTheme(
      <InputMappingItem
        variableName="Prompt"
        type="fixed"
        dataType="string"
        value="hello"
        enumList={undefined}
        variable="prompt"
        onChangeMapping={onChangeMapping}
        defaultValues={{ prompt: 'default-value' }}
        mappingInfo={{}}
      />,
    );
    const typeSelect = getByRole('combobox', { name: 'Type' });
    await user.click(typeSelect);
    await user.click(await findByRole('option', { name: 'Variable' }));
    expect(onChangeMapping).toHaveBeenCalledWith('prompt', { type: 'variable', value: 'input' }, 'string');
  });

  it('does not disable the multi-value enum select when the item itself is disabled (no baseline call site passes `disabled` into this branch)', () => {
    const { getAllByRole } = renderWithTheme(
      <InputMappingItem
        variableName="Tags"
        type="fixed"
        dataType="array"
        value={['a']}
        enumList={['a', 'b']}
        variable="tags"
        onChangeMapping={vi.fn()}
        disabled
        defaultValues={{}}
        mappingInfo={{}}
      />,
    );
    // Two comboboxes render here: the Type selector, then the multi-value
    // enum select — index 1 is the latter (DOM order), same as the
    // selection test above.
    const comboboxes = getAllByRole('combobox');
    const multiSelect = comboboxes[1];
    if (!multiSelect) throw new Error('multi-select combobox not found');
    expect(multiSelect).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('disables the type selector for a boolean field regardless of the disabled prop', () => {
    const { getByRole } = renderWithTheme(
      <InputMappingItem
        variableName="Flag"
        type="fixed"
        dataType="boolean"
        value={false}
        enumList={undefined}
        variable="flag"
        onChangeMapping={vi.fn()}
        defaultValues={{}}
        mappingInfo={{}}
      />,
    );
    const typeSelect = getByRole('combobox', { name: 'Type' });
    expect(typeSelect).toHaveAttribute('aria-disabled', 'true');
  });
});
