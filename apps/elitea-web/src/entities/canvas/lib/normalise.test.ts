import { describe, expect, it } from 'vitest';

import { normaliseCanvas, unwrapCanvasSyncPayload } from './normalise';
import type { CanvasWire } from './normalise';

describe('normaliseCanvas', () => {
  it('maps every snake_case field to its camelCase counterpart', () => {
    const wire: CanvasWire = {
      uuid: 'c1',
      name: 'Snippet',
      canvas_type: 'code',
      code_language: 'python',
      canvas_content: 'print(1)',
      editors: [{ user_name: 'alice' }],
      message_group_uuid: 'm1',
    };
    expect(normaliseCanvas(wire)).toEqual({
      uuid: 'c1',
      name: 'Snippet',
      canvasType: 'code',
      codeLanguage: 'python',
      content: 'print(1)',
      editors: [{ userName: 'alice' }],
      messageGroupUuid: 'm1',
    });
  });

  it('omits optional keys entirely when absent from the wire, rather than setting them to undefined', () => {
    const result = normaliseCanvas({ uuid: 'c1' });
    expect(result).toEqual({ uuid: 'c1' });
    expect(Object.keys(result)).toEqual(['uuid']);
  });
});

describe('unwrapCanvasSyncPayload', () => {
  it('unwraps the nested content field', () => {
    const message = { content: { uuid: 'c1', canvas_content: 'x' } };
    expect(unwrapCanvasSyncPayload(message)).toEqual({ uuid: 'c1', content: 'x' });
  });
});
