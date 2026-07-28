import { describe, expect, it } from 'vitest';

import {
  calculateNameFieldWidth,
  convertValueByType,
  formatAvailableNodesForPrompt,
  formatStateVariablesForPrompt,
  getDefaultValueForType,
  getMessagesFromState,
  getValueByType,
  validateValueByType,
  validateVariableName,
} from './state.helpers';
import { DRAWER_BREAKPOINT_EXPANDED, MIN_DRAWER_WIDTH, NAME_FIELD_WIDTH_EXPANDED, NAME_FIELD_WIDTH_NARROW } from '../constants/stateDrawer.constants';

describe('calculateNameFieldWidth', () => {
  it('returns the expanded width at/above the expanded breakpoint', () => {
    expect(calculateNameFieldWidth(DRAWER_BREAKPOINT_EXPANDED)).toBe(NAME_FIELD_WIDTH_EXPANDED);
    expect(calculateNameFieldWidth(DRAWER_BREAKPOINT_EXPANDED + 100)).toBe(NAME_FIELD_WIDTH_EXPANDED);
  });

  it('returns the narrow width at the minimum drawer width', () => {
    expect(calculateNameFieldWidth(MIN_DRAWER_WIDTH)).toBe(NAME_FIELD_WIDTH_NARROW);
  });

  it('interpolates linearly at the midpoint', () => {
    const mid = (MIN_DRAWER_WIDTH + DRAWER_BREAKPOINT_EXPANDED) / 2;
    const expectedMid = Math.round((NAME_FIELD_WIDTH_NARROW + NAME_FIELD_WIDTH_EXPANDED) / 2);
    expect(calculateNameFieldWidth(mid)).toBe(expectedMid);
  });
});

describe('getDefaultValueForType', () => {
  it('returns the zero value per StateVariableType', () => {
    expect(getDefaultValueForType('str')).toBe('');
    expect(getDefaultValueForType('number')).toBe(0);
    expect(getDefaultValueForType('list')).toEqual([]);
    expect(getDefaultValueForType('dict')).toEqual({});
    expect(getDefaultValueForType('unknown')).toBe('');
  });
});

describe('getValueByType', () => {
  it('String: undefined for the `input` variable when value is falsy, else passes through', () => {
    expect(getValueByType('input', 'str', '')).toBeUndefined();
    expect(getValueByType('input', 'str', 'hello')).toBe('hello');
    expect(getValueByType('messages', 'str', '')).toBe('');
  });

  it('int (legacy): floors numbers, parses numeric strings, passes through unparsable', () => {
    expect(getValueByType('x', 'int', 3.9)).toBe(3);
    expect(getValueByType('x', 'int', '42')).toBe(42);
    expect(getValueByType('x', 'int', 'not-a-number')).toBe('not-a-number');
  });

  it('number: parses numeric strings, passes through blank/unparsable', () => {
    expect(getValueByType('x', 'number', '3.5')).toBe(3.5);
    expect(getValueByType('x', 'number', '')).toBe('');
    expect(getValueByType('x', 'number', 'nope')).toBe('nope');
  });

  it('list: JSON.parses; empty array on invalid JSON unless it is the messages variable (undefined)', () => {
    expect(getValueByType('x', 'list', '[1,2]')).toEqual([1, 2]);
    expect(getValueByType('x', 'list', 'not json')).toEqual([]);
    expect(getValueByType('messages', 'list', 'not json')).toBeUndefined();
  });

  it('dict: JSON.parses, passes through raw value on invalid JSON', () => {
    expect(getValueByType('x', 'dict', '{"a":1}')).toEqual({ a: 1 });
    expect(getValueByType('x', 'dict', 'not json')).toBe('not json');
  });
});

describe('getMessagesFromState', () => {
  it('pretty-prints the messages value when present', () => {
    expect(getMessagesFromState({ messages: { value: [{ role: 'user' }] } })).toBe(
      JSON.stringify([{ role: 'user' }], null, 2),
    );
  });

  it('returns [] when messages/value is absent', () => {
    expect(getMessagesFromState(undefined)).toEqual([]);
    expect(getMessagesFromState({})).toEqual([]);
  });
});

describe('validateVariableName', () => {
  it('empty name is valid (optional)', () => {
    expect(validateVariableName('', null, {})).toBe('');
  });

  it('rejects a name colliding with an existing state var, unless it is the one being edited', () => {
    expect(validateVariableName('foo', null, { foo: {} })).toBe('Name already exists');
    expect(validateVariableName('foo', 'foo', { foo: {} })).toBe('');
  });

  it('rejects names not matching [a-zA-Z][a-zA-Z0-9_]*', () => {
    expect(validateVariableName('1abc', null, {})).toMatch(/letter/);
    expect(validateVariableName('valid_name1', null, {})).toBe('');
  });
});

describe('validateValueByType', () => {
  it('skips validation for undefined/empty (optional value)', () => {
    expect(validateValueByType('number', undefined)).toBe('');
    expect(validateValueByType('number', '')).toBe('');
  });

  it('number: invalid unless Number()-coercible', () => {
    expect(validateValueByType('number', 'abc')).toMatch(/Invalid number/);
    expect(validateValueByType('number', '42')).toBe('');
  });

  it('list: array passes; valid JSON array string passes; anything else fails', () => {
    expect(validateValueByType('list', [1, 2])).toBe('');
    expect(validateValueByType('list', '[1,2]')).toBe('');
    expect(validateValueByType('list', '{"a":1}')).toMatch(/Invalid list/);
    expect(validateValueByType('list', 'not json')).toMatch(/Invalid list/);
    expect(validateValueByType('list', 42)).toMatch(/Invalid list/);
  });

  it('dict: plain object passes; array or JSON-array string fails; valid JSON object string passes', () => {
    expect(validateValueByType('dict', { a: 1 })).toBe('');
    expect(validateValueByType('dict', [1, 2])).toMatch(/Invalid JSON/);
    expect(validateValueByType('dict', '{"a":1}')).toBe('');
    expect(validateValueByType('dict', '[1,2]')).toMatch(/Invalid JSON/);
    expect(validateValueByType('dict', 'not json')).toMatch(/Invalid JSON/);
  });
});

describe('convertValueByType', () => {
  it('list: raw string passes through unchanged; array stringifies', () => {
    expect(convertValueByType('list', 'raw')).toBe('raw');
    expect(convertValueByType('list', [1, 2])).toBe('[1,2]');
  });

  it('dict: raw string passes through unchanged; object pretty-stringifies', () => {
    expect(convertValueByType('dict', 'raw')).toBe('raw');
    expect(convertValueByType('dict', { a: 1 })).toBe(JSON.stringify({ a: 1 }, null, 2));
  });

  it('number/int: stringifies', () => {
    expect(convertValueByType('number', 42)).toBe('42');
    expect(convertValueByType('int', 7)).toBe('7');
  });

  it('falls through to String()/JSON.stringify for everything else', () => {
    expect(convertValueByType('str', 'hi')).toBe('hi');
    expect(convertValueByType('str', [1, 2])).toBe('[1,2]');
  });
});

describe('formatStateVariablesForPrompt', () => {
  it('formats each variable as `name` (readable type)', () => {
    expect(formatStateVariablesForPrompt({ input: { type: 'str' }, count: { type: 'number' } })).toBe(
      'Available pipeline state variables: `input` (str), `count` (number)',
    );
  });

  it('returns empty string for a missing/empty state', () => {
    expect(formatStateVariablesForPrompt(undefined)).toBe('');
    expect(formatStateVariablesForPrompt({})).toBe('');
  });
});

describe('formatAvailableNodesForPrompt', () => {
  it('lists node ids plus END, filtering out state/condition-synthetic ids', () => {
    expect(formatAvailableNodesForPrompt([{ id: 'Agent 1' }, { id: 'state' }, { id: 'A~~~ConditionNode' }])).toBe(
      'Available routing targets (node IDs): `Agent 1`, `END`',
    );
  });

  it('returns empty string for an empty/missing node list', () => {
    expect(formatAvailableNodesForPrompt(undefined)).toBe('');
    expect(formatAvailableNodesForPrompt([])).toBe('');
  });
});
