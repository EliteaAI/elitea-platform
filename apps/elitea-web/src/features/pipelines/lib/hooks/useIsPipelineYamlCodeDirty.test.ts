import { describe, expect, it } from 'vitest';

import { computeIsPipelineYamlCodeDirty, isChatPath, isPipelineDetailPath } from './useIsPipelineYamlCodeDirty';

describe('isPipelineDetailPath', () => {
  it('matches /pipelines/create', () => {
    expect(isPipelineDetailPath('/pipelines/create')).toBe(true);
  });

  it('matches /pipelines/:tab/:agentId', () => {
    expect(isPipelineDetailPath('/pipelines/latest/123')).toBe(true);
  });

  it('matches /pipelines/:tab/:agentId/:version', () => {
    expect(isPipelineDetailPath('/pipelines/latest/123/v2')).toBe(true);
  });

  it('does not match the bare pipelines list route', () => {
    expect(isPipelineDetailPath('/pipelines')).toBe(false);
    expect(isPipelineDetailPath('/pipelines/latest')).toBe(false);
  });

  it('does not match an unrelated route', () => {
    expect(isPipelineDetailPath('/agents/latest/123')).toBe(false);
  });
});

describe('isChatPath', () => {
  it('matches any /chat prefix', () => {
    expect(isChatPath('/chat')).toBe(true);
    expect(isChatPath('/chat/abc-123')).toBe(true);
  });

  it('does not match a non-chat path', () => {
    expect(isChatPath('/pipelines/latest')).toBe(false);
  });
});

describe('computeIsPipelineYamlCodeDirty', () => {
  it('is false outside pipeline-editing screens even when the code differs', () => {
    expect(computeIsPipelineYamlCodeDirty('/agents/latest/1', 'a: 2', 'a: 1')).toBe(false);
  });

  it('is false on a pipeline detail page when the code is identical to the saved snapshot', () => {
    expect(computeIsPipelineYamlCodeDirty('/pipelines/latest/1', 'a: 1', 'a: 1')).toBe(false);
  });

  it('is true on a pipeline detail page when the code differs from the saved snapshot', () => {
    expect(computeIsPipelineYamlCodeDirty('/pipelines/latest/1', 'a: 2', 'a: 1')).toBe(true);
  });

  it('is true on a chat page when the code differs from the saved snapshot', () => {
    expect(computeIsPipelineYamlCodeDirty('/chat/conv-1', 'a: 2', 'a: 1')).toBe(true);
  });

  it('is false when the current code equals the canonical re-dump of the saved snapshot, even though its raw text differs', () => {
    // The saved snapshot's raw text has keys in a different order than
    // `dumpYaml`'s canonical (sorted) form would produce — the current code
    // below IS that canonical form, so it counts as clean even though it is
    // not byte-identical to `initYamlCode`.
    const initYamlCode = 'b: 2\na: 1\n';
    const canonicalRedump = 'a: 1\nb: 2\n';
    expect(computeIsPipelineYamlCodeDirty('/pipelines/latest/1', canonicalRedump, initYamlCode)).toBe(false);
  });

  it('treats unparsable saved-snapshot YAML as producing an empty re-dump, so any non-empty current code is dirty', () => {
    expect(computeIsPipelineYamlCodeDirty('/pipelines/latest/1', 'a: 1', '::: not yaml [')).toBe(true);
  });
});
