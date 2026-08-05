import { describe, expect, it } from 'vitest';

import { convertToValidEliteaTitle, getEliteATitleValidationError, isValidEliteATitle } from './eliteaTitle';

describe('convertToValidEliteaTitle', () => {
  it('lowercases and replaces whitespace with underscores', () => {
    expect(convertToValidEliteaTitle('My Tool Name')).toBe('my_tool_name');
  });

  it('strips characters outside [a-z0-9_-]', () => {
    expect(convertToValidEliteaTitle('My Tool! @Name#')).toBe('my_tool_name');
  });

  it('collapses repeated underscores', () => {
    expect(convertToValidEliteaTitle('a   b')).toBe('a_b');
  });

  it('trims a trailing underscore left by trailing whitespace', () => {
    expect(convertToValidEliteaTitle('trailing   ')).toBe('trailing');
  });

  it('truncates to 128 characters and trims a trailing underscore from the cut', () => {
    const input = 'a'.repeat(127) + ' b';
    const result = convertToValidEliteaTitle(input);
    expect(result.length).toBeLessThanOrEqual(128);
    expect(result.endsWith('_')).toBe(false);
  });

  it('returns the fallback for an empty input', () => {
    expect(convertToValidEliteaTitle('', 'untitled')).toBe('untitled');
  });

  it('returns the fallback when cleaning empties the result', () => {
    expect(convertToValidEliteaTitle('!!!', 'untitled')).toBe('untitled');
  });

  it('returns "" fallback by default', () => {
    expect(convertToValidEliteaTitle(undefined)).toBe('');
  });
});

describe('isValidEliteATitle', () => {
  it('accepts alphanumeric, underscore, and hyphen', () => {
    expect(isValidEliteATitle('my_tool-1')).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(isValidEliteATitle('')).toBe(false);
  });

  it('rejects undefined', () => {
    expect(isValidEliteATitle(undefined)).toBe(false);
  });

  it('rejects a string longer than 128 characters', () => {
    expect(isValidEliteATitle('a'.repeat(129))).toBe(false);
  });

  it('rejects whitespace or other special characters', () => {
    expect(isValidEliteATitle('my tool')).toBe(false);
  });
});

describe('getEliteATitleValidationError', () => {
  it('reports an empty value', () => {
    expect(getEliteATitleValidationError('', 'Elitea')).toBe('Elitea title cannot be empty');
  });

  it('reports a too-long value', () => {
    expect(getEliteATitleValidationError('a'.repeat(129), 'Elitea')).toBe(
      'Elitea title must not exceed 128 characters',
    );
  });

  it('reports invalid characters', () => {
    expect(getEliteATitleValidationError('has space', 'Elitea')).toBe(
      'Elitea title must contain only alphanumeric characters, underscores, and hyphens (no spaces or other special symbols)',
    );
  });

  it('returns null for a valid value', () => {
    expect(getEliteATitleValidationError('valid_title-1', 'Elitea')).toBeNull();
  });

  it('interpolates a custom participant name', () => {
    expect(getEliteATitleValidationError('', 'Acme')).toBe('Acme title cannot be empty');
  });
});
