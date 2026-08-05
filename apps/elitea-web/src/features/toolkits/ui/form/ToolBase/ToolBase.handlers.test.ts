import { describe, expect, it, vi } from 'vitest';

import { createHandleInputChange } from './ToolBase.handlers';
import type { ToolSchema } from './types';

/** Minimal fake of the one field `handleInputChange` reads off a real `ChangeEvent<HTMLInputElement>`. */
function changeEvent(value: string): { target: { value: string } } {
  return { target: { value } };
}

describe('createHandleInputChange', () => {
  it('writes a plain string field through unchanged', () => {
    const editField = vi.fn();
    const schema: ToolSchema = { properties: { url: { type: 'string' } } };
    const handleInputChange = createHandleInputChange({
      schema,
      setToolErrors: vi.fn(),
      editField,
      settings: {},
      onConfigurationNameChange: undefined,
    });

    handleInputChange('settings.url')(changeEvent('https://example.com') as never);

    expect(editField).toHaveBeenCalledWith('settings.url', 'https://example.com');
  });

  it('writes the field through unchanged when the schema has no entry for it (ToolBase.jsx:186 guard)', () => {
    const editField = vi.fn();
    const schema: ToolSchema = { properties: {} };
    const handleInputChange = createHandleInputChange({
      schema,
      setToolErrors: vi.fn(),
      editField,
      settings: {},
      onConfigurationNameChange: undefined,
    });

    handleInputChange('settings.unknown_field')(changeEvent('anything') as never);

    expect(editField).toHaveBeenCalledWith('settings.unknown_field', 'anything');
  });

  describe('integer fields', () => {
    it('strips non-digit characters before writing', () => {
      const editField = vi.fn();
      const schema: ToolSchema = { properties: { limit: { type: 'integer' } } };
      const handleInputChange = createHandleInputChange({
        schema,
        setToolErrors: vi.fn(),
        editField,
        settings: {},
        onConfigurationNameChange: undefined,
      });

      handleInputChange('settings.limit')(changeEvent('1a2b3') as never);

      expect(editField).toHaveBeenCalledWith('settings.limit', '123');
    });

    it('clears the field error when the sanitized value satisfies its constraints', () => {
      const setToolErrors = vi.fn();
      const editField = vi.fn();
      const schema: ToolSchema = { properties: { limit: { type: 'integer', minimum: 1 } } };
      const handleInputChange = createHandleInputChange({
        schema,
        setToolErrors,
        editField,
        settings: {},
        onConfigurationNameChange: undefined,
      });

      handleInputChange('settings.limit')(changeEvent('5') as never);

      expect(setToolErrors).toHaveBeenCalled();
      const updater = setToolErrors.mock.calls[0]?.[0] as (previous: Record<string, unknown>) => Record<string, unknown>;
      expect(updater({ limit: 'Value must be at least 1' })).toEqual({ limit: false });
    });

    it('sets a constraint-violation error message on the field', () => {
      const setToolErrors = vi.fn();
      const editField = vi.fn();
      const schema: ToolSchema = { properties: { limit: { type: 'integer', minimum: 5 } } };
      const handleInputChange = createHandleInputChange({
        schema,
        setToolErrors,
        editField,
        settings: {},
        onConfigurationNameChange: undefined,
      });

      handleInputChange('settings.limit')(changeEvent('2') as never);

      const updater = setToolErrors.mock.calls[0]?.[0] as (previous: Record<string, unknown>) => Record<string, unknown>;
      expect(updater({})).toEqual({ limit: 'Value must be at least 5' });
      // the sanitized (digits-only) value is still written through
      expect(editField).toHaveBeenCalledWith('settings.limit', '2');
    });
  });

  describe('pattern-guarded fields', () => {
    // `pattern` is a real JSON-Schema keyword `sanitizeInputValue` reads
    // (`ToolBase.handlers.ts`'s own local `propertySchema as ToolPropertySchema
    // & {pattern?: string}` cast) but `ToolPropertySchema` (`types.ts`) does not
    // formally declare it — same reason this schema is built as a plain object
    // and asserted, not annotated (an annotated literal would fail TS's
    // excess-property check on `pattern`).
    function patternSchema(pattern: string): ToolSchema {
      return { properties: { code: { type: 'string', pattern } } } as ToolSchema;
    }

    it('rejects a keystroke that would violate the field pattern (no editField call)', () => {
      const editField = vi.fn();
      const handleInputChange = createHandleInputChange({
        schema: patternSchema('^[A-Z]*$'),
        setToolErrors: vi.fn(),
        editField,
        settings: {},
        onConfigurationNameChange: undefined,
      });

      handleInputChange('settings.code')(changeEvent('lowercase') as never);

      expect(editField).not.toHaveBeenCalled();
    });

    it('allows clearing a pattern-guarded field to empty', () => {
      const editField = vi.fn();
      const handleInputChange = createHandleInputChange({
        schema: patternSchema('^[A-Z]*$'),
        setToolErrors: vi.fn(),
        editField,
        settings: {},
        onConfigurationNameChange: undefined,
      });

      handleInputChange('settings.code')(changeEvent('') as never);

      expect(editField).toHaveBeenCalledWith('settings.code', '');
    });

    it('accepts a keystroke matching the pattern', () => {
      const editField = vi.fn();
      const handleInputChange = createHandleInputChange({
        schema: patternSchema('^[A-Z]*$'),
        setToolErrors: vi.fn(),
        editField,
        settings: {},
        onConfigurationNameChange: undefined,
      });

      handleInputChange('settings.code')(changeEvent('ABC') as never);

      expect(editField).toHaveBeenCalledWith('settings.code', 'ABC');
    });
  });

  describe('settings.label -> settings.elitea_title sync (ToolBase.jsx:207-214)', () => {
    it('derives and writes elitea_title from a new label when they diverge', () => {
      const editField = vi.fn();
      const schema: ToolSchema = { properties: { label: { type: 'string' } } };
      const handleInputChange = createHandleInputChange({
        schema,
        setToolErrors: vi.fn(),
        editField,
        settings: { elitea_title: 'old_title' },
        onConfigurationNameChange: undefined,
      });

      handleInputChange('settings.label')(changeEvent('My New Label') as never);

      expect(editField).toHaveBeenCalledWith('settings.label', 'My New Label');
      expect(editField).toHaveBeenCalledWith('settings.elitea_title', 'my_new_label');
    });

    it('does not re-write elitea_title when the derived slug already matches', () => {
      const editField = vi.fn();
      const schema: ToolSchema = { properties: { label: { type: 'string' } } };
      const handleInputChange = createHandleInputChange({
        schema,
        setToolErrors: vi.fn(),
        editField,
        settings: { elitea_title: 'my_label' },
        onConfigurationNameChange: undefined,
      });

      handleInputChange('settings.label')(changeEvent('My Label') as never);

      expect(editField).toHaveBeenCalledTimes(1);
      expect(editField).toHaveBeenCalledWith('settings.label', 'My Label');
    });

    it('lowercases and truncates a directly-edited elitea_title to MAX_NAME_LENGTH (32)', () => {
      const editField = vi.fn();
      const schema: ToolSchema = { properties: { elitea_title: { type: 'string' } } };
      const handleInputChange = createHandleInputChange({
        schema,
        setToolErrors: vi.fn(),
        editField,
        settings: {},
        onConfigurationNameChange: undefined,
      });

      const longValue = 'A'.repeat(40);
      handleInputChange('settings.elitea_title')(changeEvent(longValue) as never);

      expect(editField).toHaveBeenCalledWith('settings.elitea_title', 'a'.repeat(32));
    });
  });

  describe('onConfigurationNameChange (ToolBase.jsx:215-217)', () => {
    it('notifies the caller when elitea_title changes', () => {
      const onConfigurationNameChange = vi.fn();
      const schema: ToolSchema = { properties: { elitea_title: { type: 'string' } } };
      const handleInputChange = createHandleInputChange({
        schema,
        setToolErrors: vi.fn(),
        editField: vi.fn(),
        settings: {},
        onConfigurationNameChange,
      });

      handleInputChange('settings.elitea_title')(changeEvent('slug') as never);

      expect(onConfigurationNameChange).toHaveBeenCalledWith('slug');
    });

    it('notifies the caller when the bare "title" field changes', () => {
      const onConfigurationNameChange = vi.fn();
      const schema: ToolSchema = { properties: { title: { type: 'string' } } };
      const handleInputChange = createHandleInputChange({
        schema,
        setToolErrors: vi.fn(),
        editField: vi.fn(),
        settings: {},
        onConfigurationNameChange,
      });

      handleInputChange('title')(changeEvent('New Title') as never);

      expect(onConfigurationNameChange).toHaveBeenCalledWith('New Title');
    });

    it('does not notify the caller for an unrelated field', () => {
      const onConfigurationNameChange = vi.fn();
      const schema: ToolSchema = { properties: { url: { type: 'string' } } };
      const handleInputChange = createHandleInputChange({
        schema,
        setToolErrors: vi.fn(),
        editField: vi.fn(),
        settings: {},
        onConfigurationNameChange,
      });

      handleInputChange('settings.url')(changeEvent('https://example.com') as never);

      expect(onConfigurationNameChange).not.toHaveBeenCalled();
    });

    it('is a no-op when onConfigurationNameChange is not supplied', () => {
      const editField = vi.fn();
      const schema: ToolSchema = { properties: { title: { type: 'string' } } };
      const handleInputChange = createHandleInputChange({
        schema,
        setToolErrors: vi.fn(),
        editField,
        settings: {},
        onConfigurationNameChange: undefined,
      });

      expect(() => handleInputChange('title')(changeEvent('New Title') as never)).not.toThrow();
      expect(editField).toHaveBeenCalledWith('title', 'New Title');
    });
  });
});
