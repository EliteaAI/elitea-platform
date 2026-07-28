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
});

describe('getNodePosition', () => {
  it('stacks vertically by default', () => {
    expect(getNodePosition([{}, {}])).toEqual({ x: 60, y: 1540 });
  });

  it('stacks horizontally when asked', () => {
    expect(getNodePosition([{}], ORIENTATION.horizontal)).toEqual({ x: 730, y: 200 });
  });
});
