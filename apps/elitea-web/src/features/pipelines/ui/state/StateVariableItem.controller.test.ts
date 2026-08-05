import type { ChangeEvent, KeyboardEvent } from 'react';

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { calculateNameFieldWidth } from '../../lib/flow-editor/helpers/state.helpers';

import { useStateVariableItemController } from './StateVariableItem.controller';
import type { StateVariableItemProps } from './StateVariableItem.types';

function baseProps(overrides: Partial<StateVariableItemProps> = {}): StateVariableItemProps {
  return {
    name: 'my_var',
    type: 'str',
    defaultValue: '',
    ...overrides,
  };
}

function changeEvent(value: string): ChangeEvent<HTMLInputElement> {
  return { target: { value } } as ChangeEvent<HTMLInputElement>;
}

function keyDownEvent(key: string, targetOverrides: Partial<HTMLInputElement> = {}): KeyboardEvent<HTMLInputElement> {
  const target = { blur: vi.fn(), ...targetOverrides };
  return { key, target } as unknown as KeyboardEvent<HTMLInputElement>;
}

describe('useStateVariableItemController', () => {
  describe('initial state', () => {
    it('display mode: isCreateMode false, isEditing false, editValue seeded from name', () => {
      const { result } = renderHook(() => useStateVariableItemController(baseProps({ name: 'abc' })));
      expect(result.current.isCreateMode).toBe(false);
      expect(result.current.isEditing).toBe(false);
      expect(result.current.editValue).toBe('abc');
    });

    it('create mode: isCreateMode true, isEditing starts true', () => {
      const { result } = renderHook(() => useStateVariableItemController(baseProps({ mode: 'create', name: '' })));
      expect(result.current.isCreateMode).toBe(true);
      expect(result.current.isEditing).toBe(true);
    });

    it('shouldExpandNameField is true only for a default (non-create) row', () => {
      const { result: defaultRow } = renderHook(() => useStateVariableItemController(baseProps({ isDefault: true })));
      expect(defaultRow.current.shouldExpandNameField).toBe(true);

      const { result: createDefaultRow } = renderHook(() =>
        useStateVariableItemController(baseProps({ isDefault: true, mode: 'create' })),
      );
      expect(createDefaultRow.current.shouldExpandNameField).toBe(false);

      const { result: customRow } = renderHook(() => useStateVariableItemController(baseProps({ isDefault: false })));
      expect(customRow.current.shouldExpandNameField).toBe(false);
    });

    it('nameFieldWidth matches calculateNameFieldWidth(drawerWidth), including the default drawerWidth=300', () => {
      const { result: defaultWidth } = renderHook(() => useStateVariableItemController(baseProps()));
      expect(defaultWidth.current.nameFieldWidth).toBe(`${calculateNameFieldWidth(300)}px`);

      const { result: customWidth } = renderHook(() => useStateVariableItemController(baseProps({ drawerWidth: 550 })));
      expect(customWidth.current.nameFieldWidth).toBe(`${calculateNameFieldWidth(550)}px`);
    });
  });

  describe('validationError sync effect', () => {
    it('computes validationError from validateValueByType(type, defaultValue) on mount', () => {
      const { result } = renderHook(() => useStateVariableItemController(baseProps({ type: 'number', defaultValue: 'not-a-number' })));
      expect(result.current.validationError).not.toBe('');
    });

    it('recomputes validationError when type/defaultValue change on rerender', () => {
      const { result, rerender } = renderHook(
        (props: StateVariableItemProps) => useStateVariableItemController(props),
        { initialProps: baseProps({ type: 'number', defaultValue: 'bad' }) },
      );
      expect(result.current.validationError).not.toBe('');

      rerender(baseProps({ type: 'number', defaultValue: '5' }));
      expect(result.current.validationError).toBe('');
    });
  });

  describe('handleStartEdit', () => {
    it('enters edit mode (seeding editValue) for a non-default, non-create row', () => {
      const { result } = renderHook(() => useStateVariableItemController(baseProps({ name: 'abc', isDefault: false })));
      act(() => result.current.handleStartEdit());
      expect(result.current.isEditing).toBe(true);
      expect(result.current.editValue).toBe('abc');
    });

    it('does nothing for a default row', () => {
      const { result } = renderHook(() => useStateVariableItemController(baseProps({ isDefault: true })));
      act(() => result.current.handleStartEdit());
      expect(result.current.isEditing).toBe(false);
    });

    it('does nothing in create mode', () => {
      const { result } = renderHook(() => useStateVariableItemController(baseProps({ mode: 'create', name: '' })));
      act(() => result.current.handleStartEdit());
      // Was already true from create-mode init; confirm it doesn't crash and stays true.
      expect(result.current.isEditing).toBe(true);
    });
  });

  describe('handleNameChange', () => {
    it('sets editValue and clears nameError when no validateName is provided', () => {
      const { result } = renderHook(() => useStateVariableItemController(baseProps({ validateName: undefined })));
      act(() => result.current.handleNameChange(changeEvent('new_name')));
      expect(result.current.editValue).toBe('new_name');
      expect(result.current.nameError).toBe('');
    });

    it('sets nameError from validateName when the new value differs from the current name', () => {
      const validateName = vi.fn(() => 'taken');
      const { result } = renderHook(() => useStateVariableItemController(baseProps({ name: 'old', validateName })));
      act(() => result.current.handleNameChange(changeEvent('new')));
      expect(validateName).toHaveBeenCalledWith('new', 'old');
      expect(result.current.nameError).toBe('taken');
    });

    it('clears nameError when the new value equals the current name (no-op rename)', () => {
      const validateName = vi.fn(() => 'taken');
      const { result } = renderHook(() => useStateVariableItemController(baseProps({ name: 'old', validateName })));
      act(() => result.current.handleNameChange(changeEvent('old')));
      expect(result.current.nameError).toBe('');
    });

    it('clears nameError for an empty value', () => {
      const validateName = vi.fn(() => 'taken');
      const { result } = renderHook(() => useStateVariableItemController(baseProps({ name: 'old', validateName })));
      act(() => result.current.handleNameChange(changeEvent('')));
      expect(result.current.nameError).toBe('');
    });
  });

  describe('handleNameBlur', () => {
    it('commits the rename via onUpdateName when the value changed and there is no error', () => {
      const onUpdateName = vi.fn();
      const { result } = renderHook(() => useStateVariableItemController(baseProps({ name: 'old', onUpdateName })));
      act(() => result.current.handleNameChange(changeEvent('new')));
      act(() => result.current.handleNameBlur());
      expect(onUpdateName).toHaveBeenCalledWith('old', 'new');
      expect(result.current.isEditing).toBe(false);
      expect(result.current.nameError).toBe('');
    });

    it('does not commit when nameError is set', () => {
      const onUpdateName = vi.fn();
      const validateName = vi.fn(() => 'taken');
      const { result } = renderHook(() => useStateVariableItemController(baseProps({ name: 'old', validateName, onUpdateName })));
      act(() => result.current.handleNameChange(changeEvent('new')));
      act(() => result.current.handleNameBlur());
      expect(onUpdateName).not.toHaveBeenCalled();
    });

    it('does not commit when the value is unchanged', () => {
      const onUpdateName = vi.fn();
      const { result } = renderHook(() => useStateVariableItemController(baseProps({ name: 'old', onUpdateName })));
      act(() => result.current.handleNameBlur());
      expect(onUpdateName).not.toHaveBeenCalled();
    });

    it('cancels create mode on blur with an empty value', () => {
      const onCancel = vi.fn();
      const { result } = renderHook(() => useStateVariableItemController(baseProps({ mode: 'create', name: '', onCancel })));
      act(() => result.current.handleNameBlur());
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('cancels create mode on blur with a nameError present', () => {
      const onCancel = vi.fn();
      const validateName = vi.fn(() => 'invalid');
      const { result } = renderHook(() =>
        useStateVariableItemController(baseProps({ mode: 'create', name: '', validateName, onCancel })),
      );
      act(() => result.current.handleNameChange(changeEvent('bad!')));
      act(() => result.current.handleNameBlur());
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('does not cancel a non-create row even with an empty value', () => {
      const onCancel = vi.fn();
      const { result } = renderHook(() => useStateVariableItemController(baseProps({ name: 'old', onCancel })));
      act(() => result.current.handleNameBlur());
      expect(onCancel).not.toHaveBeenCalled();
    });
  });

  describe('handleNameKeyDown', () => {
    it('Enter blurs the input and does not touch isEditing/editValue', () => {
      const { result } = renderHook(() => useStateVariableItemController(baseProps({ name: 'old' })));
      act(() => result.current.handleStartEdit());
      const target = { blur: vi.fn() };
      act(() => result.current.handleNameKeyDown(keyDownEvent('Enter', target)));
      expect(target.blur).toHaveBeenCalledTimes(1);
    });

    it('Escape in edit mode reverts editValue to name and exits editing', () => {
      const { result } = renderHook(() => useStateVariableItemController(baseProps({ name: 'old' })));
      act(() => result.current.handleStartEdit());
      act(() => result.current.handleNameChange(changeEvent('typed')));
      expect(result.current.editValue).toBe('typed');

      act(() => result.current.handleNameKeyDown(keyDownEvent('Escape')));
      expect(result.current.isEditing).toBe(false);
      expect(result.current.editValue).toBe('old');
    });

    it('Escape in create mode calls onCancel instead of reverting local state', () => {
      const onCancel = vi.fn();
      const { result } = renderHook(() => useStateVariableItemController(baseProps({ mode: 'create', name: '', onCancel })));
      act(() => result.current.handleNameKeyDown(keyDownEvent('Escape')));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('any other key is a no-op', () => {
      const onCancel = vi.fn();
      const { result } = renderHook(() => useStateVariableItemController(baseProps({ name: 'old', onCancel })));
      act(() => result.current.handleStartEdit());
      act(() => result.current.handleNameKeyDown(keyDownEvent('a')));
      expect(result.current.isEditing).toBe(true);
      expect(onCancel).not.toHaveBeenCalled();
    });
  });

  describe('handleTypeChange', () => {
    it('forwards to onUpdateType(name, newType) outside create mode', () => {
      const onUpdateType = vi.fn();
      const { result } = renderHook(() => useStateVariableItemController(baseProps({ name: 'my_var', onUpdateType })));
      act(() => result.current.handleTypeChange('number'));
      expect(onUpdateType).toHaveBeenCalledWith('my_var', 'number');
    });

    it('is a no-op in create mode', () => {
      const onUpdateType = vi.fn();
      const { result } = renderHook(() =>
        useStateVariableItemController(baseProps({ mode: 'create', name: '', onUpdateType })),
      );
      act(() => result.current.handleTypeChange('number'));
      expect(onUpdateType).not.toHaveBeenCalled();
    });
  });

  it('handleToggleChange forwards to onToggle(name, checked)', () => {
    const onToggle = vi.fn();
    const { result } = renderHook(() => useStateVariableItemController(baseProps({ name: 'my_var', onToggle })));
    act(() => result.current.handleToggleChange(true));
    expect(onToggle).toHaveBeenCalledWith('my_var', true);
  });

  describe('handleDeleteClick', () => {
    it('calls onDelete(name) outside create mode', () => {
      const onDelete = vi.fn();
      const { result } = renderHook(() => useStateVariableItemController(baseProps({ name: 'my_var', onDelete })));
      act(() => result.current.handleDeleteClick());
      expect(onDelete).toHaveBeenCalledWith('my_var');
    });

    it('calls onCancel instead, in create mode', () => {
      const onDelete = vi.fn();
      const onCancel = vi.fn();
      const { result } = renderHook(() =>
        useStateVariableItemController(baseProps({ mode: 'create', name: '', onDelete, onCancel })),
      );
      act(() => result.current.handleDeleteClick());
      expect(onDelete).not.toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
  });

  it('handleDefaultValueClick/Close toggle isDefaultValueModalOpen', () => {
    const { result } = renderHook(() => useStateVariableItemController(baseProps()));
    expect(result.current.isDefaultValueModalOpen).toBe(false);
    act(() => result.current.handleDefaultValueClick());
    expect(result.current.isDefaultValueModalOpen).toBe(true);
    act(() => result.current.handleDefaultValueClose());
    expect(result.current.isDefaultValueModalOpen).toBe(false);
  });

  it('handleDefaultValueModalChange forwards (name, type, value) to onUpdateDefaultValue', () => {
    const onUpdateDefaultValue = vi.fn();
    const { result } = renderHook(() =>
      useStateVariableItemController(baseProps({ name: 'my_var', type: 'str', onUpdateDefaultValue })),
    );
    act(() => result.current.handleDefaultValueModalChange('new value'));
    expect(onUpdateDefaultValue).toHaveBeenCalledWith('my_var', 'str', 'new value');
  });

  it('handleDefaultValueInlineChange forwards (name, type, event.target.value) to onUpdateDefaultValue', () => {
    const onUpdateDefaultValue = vi.fn();
    const { result } = renderHook(() =>
      useStateVariableItemController(baseProps({ name: 'my_var', type: 'number', onUpdateDefaultValue })),
    );
    act(() => result.current.handleDefaultValueInlineChange(changeEvent('42')));
    expect(onUpdateDefaultValue).toHaveBeenCalledWith('my_var', 'number', '42');
  });
});
