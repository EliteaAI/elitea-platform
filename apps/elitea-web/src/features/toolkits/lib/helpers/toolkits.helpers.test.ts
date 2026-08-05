import { describe, expect, it } from 'vitest';

import { enhanceToolkitData, genToolkitName, getToolkitIcon, getToolkitTypeLabel, isToolkitTypeBlocked } from './toolkits.helpers';

describe('isToolkitTypeBlocked', () => {
  it('is false when no blocklist is given', () => {
    expect(isToolkitTypeBlocked('github', undefined)).toBe(false);
  });

  it('matches case-insensitively', () => {
    expect(isToolkitTypeBlocked('GitHub', ['github'])).toBe(true);
  });

  it('matches separator-insensitively (git_hub === githuB)', () => {
    expect(isToolkitTypeBlocked('git_hub', ['GITHUB'])).toBe(true);
  });

  it('is false for an empty/undefined type', () => {
    expect(isToolkitTypeBlocked('', ['github'])).toBe(false);
    expect(isToolkitTypeBlocked(undefined, ['github'])).toBe(false);
  });

  it('is false for a type not on the list', () => {
    expect(isToolkitTypeBlocked('jira', ['github', 'gitlab'])).toBe(false);
  });
});

describe('getToolkitTypeLabel', () => {
  it('capitalizes the first letter', () => {
    expect(getToolkitTypeLabel('github')).toBe('Github');
  });

  it('trims whitespace before capitalizing', () => {
    expect(getToolkitTypeLabel('  jira  ')).toBe('Jira');
  });

  it('falls back to "Toolkit" for empty/non-string input', () => {
    expect(getToolkitTypeLabel('')).toBe('Toolkit');
    expect(getToolkitTypeLabel(undefined)).toBe('Toolkit');
  });
});

describe('genToolkitName', () => {
  it('uses the schema property flagged toolkit_name when present and non-blank', () => {
    // `cleanString` strips everything but alphanumerics/underscore/hyphen —
    // a plain space is REMOVED, not converted to `_` (only `.` folds to
    // `_`) — so `'my repo!'` cleans to `'myrepo'`.
    const schemaOfTools = { github: { properties: { repo_name: { toolkit_name: true } } } };
    const toolkit = { type: 'github', settings: { repo_name: 'my repo!' } };
    expect(genToolkitName(toolkit, schemaOfTools)).toBe('myrepo');
  });

  it('falls back to name/elitea_title/configuration_title when the keyed value is blank', () => {
    const schemaOfTools = { github: { properties: { repo_name: { toolkit_name: true } } } };
    const toolkit = { type: 'github', name: 'Fallback Name', settings: { repo_name: '' } };
    expect(genToolkitName(toolkit, schemaOfTools)).toBe('FallbackName');
  });

  it('falls back straight to name when the type has no toolkit_name-flagged property', () => {
    expect(genToolkitName({ type: 'jira', name: 'My Jira' }, {})).toBe('MyJira');
  });

  it('falls back to settings.elitea_title, then settings.configuration_title, then empty string', () => {
    expect(genToolkitName({ type: 'jira', settings: { elitea_title: 'Elitea.Title' } }, {})).toBe('Elitea_Title');
    expect(genToolkitName({ type: 'jira', settings: { configuration_title: 'Config.Title' } }, {})).toBe('Config_Title');
    expect(genToolkitName({ type: 'jira' }, {})).toBe('');
  });

  it('treats a blank name as absent (|| semantics, not ??)', () => {
    expect(genToolkitName({ type: 'jira', name: '', settings: { elitea_title: 'Real.Title' } }, {})).toBe('Real_Title');
  });
});

describe('getToolkitIcon', () => {
  it('resolves the MCP Remote category for the synthesized mcp type', () => {
    expect(getToolkitIcon({ type: 'mcp' }, {}, true)).toEqual({ iconKind: 'toolkit', label: 'Remote' });
  });

  it('resolves the MCP Local category for a user-discovered MCP server type', () => {
    expect(getToolkitIcon({ type: 'my_mcp_server' }, {}, true)).toEqual({ iconKind: 'toolkit', label: 'Local' });
  });

  it('prefers the schema metadata label for a non-MCP, non-application type', () => {
    const schemas = { github: { metadata: { label: 'GitHub' } } };
    expect(getToolkitIcon({ type: 'github' }, schemas, false)).toEqual({ iconKind: 'toolkit', label: 'GitHub' });
  });

  it('falls back to the capitalized type name when no schema label exists', () => {
    expect(getToolkitIcon({ type: 'jira' }, {}, false)).toEqual({ iconKind: 'toolkit', label: 'Jira' });
  });

  it('resolves application-typed, non-pipeline toolkits to the agent icon kind', () => {
    expect(getToolkitIcon({ type: 'application', agent_type: 'agent' }, {}, false).iconKind).toBe('agent');
  });

  it('resolves application-typed, pipeline agent_type toolkits to the pipeline icon kind', () => {
    expect(getToolkitIcon({ type: 'application', agent_type: 'pipeline' }, {}, false).iconKind).toBe('pipeline');
  });
});

describe('enhanceToolkitData', () => {
  it('returns undefined unchanged', () => {
    expect(enhanceToolkitData(undefined, {}, false)).toBeUndefined();
  });

  it('attaches tags/icon_meta/label to every toolkit', () => {
    const toolkits = [{ type: 'github' }, { type: 'jira' }];
    const result = enhanceToolkitData(toolkits, {}, false);
    expect(result?.[0]?.tags).toEqual([{ id: 'github', name: 'Github', data: { type: 'github' } }]);
    expect(result?.[0]?.icon_meta).toEqual({ iconKind: 'toolkit', alt: 'Github icon', type: 'icon-kind' });
    expect(result?.[0]?.label).toBe('Github');
    expect(result?.[1]?.label).toBe('Jira');
  });

  it('normalises the application type to "agent" in the tag data.type', () => {
    const result = enhanceToolkitData([{ type: 'application', agent_type: 'agent' }], {}, false);
    expect(result?.[0]?.tags[0]?.data.type).toBe('agent');
  });

  it('memoises icon resolution per distinct type across the batch', () => {
    // Two toolkits sharing a type get the exact same label/iconKind pair —
    // this is a behavioural assertion (both entries agree), the memoisation
    // itself is an internal perf detail not independently observable here.
    const result = enhanceToolkitData([{ type: 'github' }, { type: 'github' }], {}, false);
    expect(result?.[0]?.label).toBe(result?.[1]?.label);
    expect(result?.[0]?.icon_meta).toEqual(result?.[1]?.icon_meta);
  });

  it('preserves the original toolkit fields alongside the new ones', () => {
    const result = enhanceToolkitData([{ type: 'github', id: 'tk-1', name: 'My GH' }], {}, false);
    expect(result?.[0]).toMatchObject({ id: 'tk-1', name: 'My GH', type: 'github' });
  });
});
