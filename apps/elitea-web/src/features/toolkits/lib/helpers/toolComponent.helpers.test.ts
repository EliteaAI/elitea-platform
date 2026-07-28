import { describe, expect, it } from 'vitest';

import { ToolBase } from '../../ui/form/ToolBase/ToolBase';
import { ToolConfluence } from '../../ui/form/ToolBase/ToolConfluence';
import { ToolJira } from '../../ui/form/ToolBase/ToolJira';
import { ToolCustom } from '../../ui/form/ToolCustom';
import { getToolComponent } from './toolComponent.helpers';

describe('getToolComponent', () => {
  it('returns undefined for an undefined type (mirrors the baseline bare `return;`)', () => {
    expect(getToolComponent(undefined)).toBeUndefined();
  });

  it('resolves jira to ToolJira when not a credential context', () => {
    expect(getToolComponent('jira')).toBe(ToolJira);
  });

  it('resolves confluence to ToolConfluence when not a credential context', () => {
    expect(getToolComponent('confluence')).toBe(ToolConfluence);
  });

  it('falls through jira to the generic form when isCredential is true', () => {
    // No typed schema supplied -> ToolCustom (generic key/value form).
    expect(getToolComponent('jira', undefined, true)).toBe(ToolCustom);
  });

  it('falls through confluence to the generic form when isCredential is true', () => {
    expect(getToolComponent('confluence', undefined, true)).toBe(ToolCustom);
  });

  it('resolves an untyped-schema toolkit type to ToolCustom', () => {
    expect(getToolComponent('github')).toBe(ToolCustom);
  });

  it('resolves an untyped-schema toolkit type to ToolCustom when schema has no `type` field', () => {
    expect(getToolComponent('github', {})).toBe(ToolCustom);
  });

  it('resolves a typed-schema toolkit type to ToolBase', () => {
    expect(getToolComponent('github', { type: 'object' })).toBe(ToolBase);
  });

  it('resolves jira-with-credential-and-typed-schema to ToolBase, not ToolJira', () => {
    expect(getToolComponent('jira', { type: 'object' }, true)).toBe(ToolBase);
  });
});
