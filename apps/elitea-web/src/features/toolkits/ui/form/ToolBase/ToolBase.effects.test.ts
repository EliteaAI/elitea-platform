import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  useEliteaTitleValidation,
  useInitRequiredFields,
  useIntegerConstraintsValidation,
  useRequiredFieldsValidation,
} from './ToolBase.effects';
import type { ToolSchema } from './types';

describe('useRequiredFieldsValidation', () => {
  it('flags a missing required field as an error', () => {
    const setToolErrors = vi.fn();
    const schema: ToolSchema = { required: ['url'], properties: { url: { type: 'string' } } };
    renderHook(() => useRequiredFieldsValidation(schema, {}, [], false, setToolErrors));
    expect(setToolErrors).toHaveBeenCalled();
    const updater = setToolErrors.mock.calls[0]?.[0] as (previous: Record<string, unknown>) => Record<string, unknown>;
    expect(updater({})).toEqual({ url: true });
  });

  it('does not overwrite an existing string (message) error with a boolean', () => {
    const setToolErrors = vi.fn();
    const schema: ToolSchema = { required: ['url'], properties: { url: { type: 'string' } } };
    renderHook(() => useRequiredFieldsValidation(schema, {}, [], false, setToolErrors));
    const updater = setToolErrors.mock.calls[0]?.[0] as (previous: Record<string, unknown>) => Record<string, unknown>;
    expect(updater({ url: 'Value must be greater than 0' })).toEqual({ url: 'Value must be greater than 0' });
  });
});

describe('useIntegerConstraintsValidation', () => {
  it('sets a constraint error for an out-of-range integer field', () => {
    const setToolErrors = vi.fn();
    const schema: ToolSchema = { properties: { limit: { type: 'integer', minimum: 1 } } };
    renderHook(() => useIntegerConstraintsValidation(schema, { limit: 0 }, setToolErrors));
    expect(setToolErrors).toHaveBeenCalled();
    const updater = setToolErrors.mock.calls[0]?.[0] as (previous: Record<string, unknown>) => Record<string, unknown>;
    expect(updater({})).toEqual({ limit: 'Value must be at least 1' });
  });

  it('does not call setToolErrors when no field has constraint errors', () => {
    const setToolErrors = vi.fn();
    const schema: ToolSchema = { properties: { limit: { type: 'integer', minimum: 1 } } };
    renderHook(() => useIntegerConstraintsValidation(schema, { limit: 5 }, setToolErrors));
    expect(setToolErrors).not.toHaveBeenCalled();
  });

  it('does nothing when schema.properties is absent', () => {
    const setToolErrors = vi.fn();
    renderHook(() => useIntegerConstraintsValidation({}, {}, setToolErrors));
    expect(setToolErrors).not.toHaveBeenCalled();
  });
});

describe('useInitRequiredFields', () => {
  it('seeds a missing required field with its schema default via editField', () => {
    const editField = vi.fn();
    const schema: ToolSchema = { required: ['label'], properties: { label: { type: 'string', default: 'preset' } } };
    renderHook(() => useInitRequiredFields(schema, {}, [], true, editField));
    expect(editField).toHaveBeenCalledWith('settings.label', 'preset');
  });

  it('does not touch a required field that already has a value', () => {
    const editField = vi.fn();
    const schema: ToolSchema = { required: ['label'], properties: { label: { type: 'string' } } };
    renderHook(() => useInitRequiredFields(schema, { label: 'already set' }, [], true, editField));
    expect(editField).not.toHaveBeenCalled();
  });

  it('does nothing when shouldInitRequiredFields is false', () => {
    const editField = vi.fn();
    const schema: ToolSchema = { required: ['label'], properties: { label: { type: 'string' } } };
    renderHook(() => useInitRequiredFields(schema, {}, [], false, editField));
    expect(editField).not.toHaveBeenCalled();
  });

  it('skips a required field owned by a metadata section', () => {
    const editField = vi.fn();
    const schema: ToolSchema = { required: ['client_id'], properties: { client_id: { type: 'string' } } };
    renderHook(() => useInitRequiredFields(schema, {}, ['client_id'], true, editField));
    expect(editField).not.toHaveBeenCalled();
  });
});

describe('useEliteaTitleValidation', () => {
  it('sets an error message for an invalid elitea_title', () => {
    const setToolErrors = vi.fn();
    renderHook(() => useEliteaTitleValidation({ elitea_title: 'has space' }, true, setToolErrors));
    expect(setToolErrors).toHaveBeenCalled();
    const updater = setToolErrors.mock.calls[0]?.[0] as (previous: Record<string, unknown>) => Record<string, unknown>;
    expect(updater({})['elitea_title']).toContain('alphanumeric');
  });

  it('does not validate when enableEditEliteaTitle is false', () => {
    const setToolErrors = vi.fn();
    renderHook(() => useEliteaTitleValidation({ elitea_title: 'has space' }, false, setToolErrors));
    expect(setToolErrors).not.toHaveBeenCalled();
  });

  it('does not validate an empty elitea_title', () => {
    const setToolErrors = vi.fn();
    renderHook(() => useEliteaTitleValidation({ elitea_title: '' }, true, setToolErrors));
    expect(setToolErrors).not.toHaveBeenCalled();
  });
});
