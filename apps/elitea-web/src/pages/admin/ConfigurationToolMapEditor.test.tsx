/**
 * The Guardrails map editor's pure parts.
 *
 * The value round trip and the duplicate detection are the two places this
 * control can lose an operator's work, so they are tested directly rather than
 * through the rendered form.
 */
import { describe, expect, it } from 'vitest';

import {
  canonicalConfigKey,
  duplicateToolkitRows,
  fromConfigToolMapRows,
  toConfigToolMapRows,
} from './ConfigurationToolMapEditor';
import { isToolMapField, widgetFor } from './configurationFields';

describe('canonicalConfigKey', () => {
  it('collapses case and separators the way the guardrail does', () => {
    for (const styled of ['Create File', 'create_file', 'create-file', 'CreateFile']) {
      expect(canonicalConfigKey(styled)).toBe('createfile');
    }
  });

  it('preserves the wildcard, which is not a toolkit name', () => {
    expect(canonicalConfigKey('*')).toBe('*');
    expect(canonicalConfigKey(' * ')).toBe('*');
  });

  it('reduces a separator-only value to nothing', () => {
    expect(canonicalConfigKey('---')).toBe('');
  });
});

describe('the value round trip', () => {
  it('reads a stored map into sorted rows', () => {
    expect(toConfigToolMapRows({ sharepoint: ['read'], github: ['create_issue'] })).toEqual([
      { toolkit: 'github', tools: ['create_issue'] },
      { toolkit: 'sharepoint', tools: ['read'] },
    ]);
  });

  it('survives a value the store should never have held', () => {
    // The server refuses these, so reaching them means someone wrote SQL. The
    // editor must still render something the operator can delete.
    expect(toConfigToolMapRows({ github: 'create_issue' })).toEqual([
      { toolkit: 'github', tools: [] },
    ]);
    expect(toConfigToolMapRows(['github'])).toEqual([]);
    expect(toConfigToolMapRows(null)).toEqual([]);
  });

  it('keeps a named toolkit with no tools, and drops an unnamed row', () => {
    // A named-but-empty row is a half-finished statement, not a mistake:
    // dropping it would delete the row on the keystroke that named it.
    expect(
      fromConfigToolMapRows([
        { toolkit: 'github', tools: [] },
        { toolkit: '   ', tools: ['create_issue'] },
      ]),
    ).toEqual({ github: [] });
  });

  it('trims and drops blank tool entries', () => {
    expect(fromConfigToolMapRows([{ toolkit: ' github ', tools: [' create_issue ', '  '] }])).toEqual(
      { github: ['create_issue'] },
    );
  });
});

describe('duplicateToolkitRows', () => {
  it('flags the LATER row, which is the one a JSON object would lose', () => {
    const rows = [
      { toolkit: 'GitHub', tools: ['a'] },
      { toolkit: 'git_hub', tools: ['b'] },
      { toolkit: 'sharepoint', tools: ['c'] },
    ];
    expect([...duplicateToolkitRows(rows)]).toEqual([1]);
  });

  it('does not flag blank rows against each other', () => {
    // Two rows the operator has just added are not a conflict.
    expect([...duplicateToolkitRows([{ toolkit: '', tools: [] }, { toolkit: '', tools: [] }])]).toEqual(
      [],
    );
  });
});

describe('widgetFor, for the guardrail maps', () => {
  const mapField = {
    key: 'blocked_tools',
    type: 'object',
    title: 'Blocked Tools',
    additionalProperties: { type: 'array', items: { type: 'string' } },
  } as const;

  it('renders a declared string-list map as the map editor', () => {
    expect(isToolMapField(mapField)).toBe(true);
    expect(widgetFor(mapField)).toBe('toolMap');
  });

  it('refuses an object whose value shape is undeclared', () => {
    // Its values could be anything, so an editor would invite the operator to
    // type what the consumer drops on the floor.
    const untyped = { key: 'mcp_servers', type: 'object', title: 'MCP Servers' } as const;
    expect(isToolMapField(untyped)).toBe(false);
    expect(widgetFor(untyped)).toBe('none');
  });

  it('still puts an unavailable reason ahead of the shape', () => {
    expect(widgetFor({ ...mapField, unavailable_reason: 'not here' })).toBe('unavailable');
  });
});
