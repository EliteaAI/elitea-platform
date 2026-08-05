import { describe, expect, it } from 'vitest';

import { getNodePosition, parseState } from './parsePipelineState.helpers';
import { ORIENTATION } from '../constants/flowEditor.constants';

describe('parseState', () => {
  it('returns null when the document has no state', () => {
    expect(parseState(undefined)).toBeNull();
    expect(parseState({})).toBeNull();
  });

  it('puts input/messages first (new-format {type,value}), then the rest', () => {
    const node = parseState({
      state: {
        extra: { type: 'dict', value: {} },
        input: { type: 'str', value: 'hi' },
        messages: { type: 'list', value: [] },
      },
    });
    expect(node?.data?.['variables']).toEqual([
      { id: 'input', name: 'input', type: 'str', value: 'hi', enabled: true },
      { id: 'messages', name: 'messages', type: 'list', value: [], enabled: true },
      { id: 'extra', name: 'extra', type: 'dict', value: {} },
    ]);
    expect(node?.type).toBe('state');
    expect(node?.draggable).toBe(false);
  });

  it('accepts the legacy bare-type-string state format', () => {
    const node = parseState({ state: { input: 'str' } });
    expect(node?.data?.['variables']).toEqual([{ id: 'input', name: 'input', type: 'str', value: undefined, enabled: true }]);
  });

  it('does not throw when a state entry is an explicit YAML `null` (regression)', () => {
    // A pipeline's stored YAML is untyped at runtime — `input: null` is a real, reachable
    // shape (js-yaml parses a bare `input:` key to `null`); `typeof null === 'object'` in JS,
    // so this takes the new-format `{ type, value }` branch with the entry itself `null`.
    const node = parseState({ state: { input: null, extra: null } } as unknown as Parameters<typeof parseState>[0]);
    expect(node?.data?.['variables']).toEqual([
      { id: 'input', name: 'input', type: 'str', value: '', enabled: true },
      { id: 'extra', name: 'extra', type: 'str', value: '' },
    ]);
  });

  it('normalizes an explicit empty-string type to "str" in both the input/messages and the remaining-entries maps (matches baseline `value?.type || "str"`)', () => {
    const node = parseState({
      state: { input: { type: '', value: 'a' }, extra: { type: '', value: 'b' } },
    });
    expect(node?.data?.['variables']).toEqual([
      { id: 'input', name: 'input', type: 'str', value: 'a', enabled: true },
      { id: 'extra', name: 'extra', type: 'str', value: 'b' },
    ]);
  });
});

describe('getNodePosition', () => {
  it('stacks vertically by default', () => {
    expect(getNodePosition([{}, {}])).toEqual({ x: 60, y: 1540 });
  });

  it('stacks horizontally when asked', () => {
    expect(getNodePosition([{}], ORIENTATION.horizontal)).toEqual({ x: 730, y: 200 });
  });
});
