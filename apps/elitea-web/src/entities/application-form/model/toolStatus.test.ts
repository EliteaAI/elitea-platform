import { describe, expect, it } from 'vitest';

import { applyMcpToolStatus, isAttachmentsEnabled } from './toolStatus';

describe('isAttachmentsEnabled', () => {
  it('is false when internalTools is undefined', () => {
    expect(isAttachmentsEnabled(undefined)).toBe(false);
  });

  it('is false when internalTools does not include "attachments"', () => {
    expect(isAttachmentsEnabled(['internal_mcp'])).toBe(false);
  });

  it('is true when internalTools includes "attachments"', () => {
    expect(isAttachmentsEnabled(['internal_mcp', 'attachments'])).toBe(true);
  });
});

describe('applyMcpToolStatus', () => {
  it('sets online on the tool matching the event type', () => {
    const tools = [{ type: 'github' }, { type: 'jira' }];
    const result = applyMcpToolStatus(tools, { type: 'jira', connected: true });
    expect(result).toEqual([{ type: 'github' }, { type: 'jira', online: true }]);
  });

  it('leaves non-matching tools untouched', () => {
    const tools = [{ type: 'github', online: true }];
    const result = applyMcpToolStatus(tools, { type: 'jira', connected: false });
    expect(result).toEqual([{ type: 'github', online: true }]);
  });

  it('does not mutate the input array', () => {
    const tools = [{ type: 'github' }];
    const copy = [...tools];
    applyMcpToolStatus(tools, { type: 'github', connected: true });
    expect(tools).toEqual(copy);
  });

  it('returns an empty array for empty input', () => {
    expect(applyMcpToolStatus([], { type: 'github', connected: true })).toEqual([]);
  });
});
