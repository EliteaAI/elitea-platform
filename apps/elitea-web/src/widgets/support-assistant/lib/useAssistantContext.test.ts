/**
 * The page-context derivation — the thing that makes an IN-APP assistant
 * different from a search box.
 *
 * The entity-id rule is the part worth pinning: this app's entity routes
 * interpose a TAB (`/agents/configuration/42`), so "the segment after the kind"
 * is the tab name on every one of them, and a derivation that took it would
 * report `current_entity_id` for a string like `configuration` or nothing at
 * all.
 */
import { describe, expect, it } from 'vitest';

import { deriveAssistantPageContext } from './useAssistantContext';

describe('deriveAssistantPageContext', () => {
  it('reports the entity from the LAST numeric segment, not the one after the kind', () => {
    expect(deriveAssistantPageContext('/agents/configuration/42')).toEqual({
      current_page: '/agents/configuration/42',
      current_entity_type: 'agent',
      current_entity_id: 42,
    });
  });

  it('handles a versioned entity route', () => {
    const context = deriveAssistantPageContext('/agents/configuration/42/7');
    expect(context.current_entity_type).toBe('agent');
    // The version is the last numeric segment on this route. It is reported as
    // the entity id, which is WRONG-ish and deliberate: the alternative is a
    // per-route table this widget would have to keep in step with the router.
    // The agent is still named by `current_page`, which carries the whole path.
    expect(context.current_entity_id).toBe(7);
  });

  it('reports NO entity on a listing', () => {
    const context = deriveAssistantPageContext('/agents');
    expect(context.current_page).toBe('/agents');
    expect(context.current_entity_type).toBe('agent');
    expect('current_entity_id' in context).toBe(false);
  });

  it('reports NO entity type for a page that names no entity kind', () => {
    const context = deriveAssistantPageContext('/settings/profile');
    expect(context.current_page).toBe('/settings/profile');
    expect('current_entity_type' in context).toBe(false);
    expect('current_entity_id' in context).toBe(false);
  });

  it('omits absent fields as KEYS rather than as undefined values', () => {
    // The payload is JSON-serialised and sent to an agent. `"current_entity_id":
    // null` reads as "there is an entity and it has no id"; an absent key reads
    // as "not on an entity page", which is the truth.
    expect(JSON.stringify(deriveAssistantPageContext('/help-center'))).toBe(
      JSON.stringify({ current_page: '/help-center' }),
    );
  });

  it('maps every entity route segment this app actually has', () => {
    for (const [path, expected] of [
      ['/pipelines/configuration/1', 'pipeline'],
      ['/skills/configuration/1', 'skill'],
      ['/toolkits/configuration/1', 'toolkit'],
      ['/mcps/1', 'mcp'],
      ['/artifacts/1', 'artifact'],
      ['/credentials/1', 'credential'],
      ['/chat/1', 'conversation'],
    ] as const) {
      expect(deriveAssistantPageContext(path).current_entity_type).toBe(expected);
    }
  });

  it('survives the root path', () => {
    expect(deriveAssistantPageContext('/')).toEqual({ current_page: '/' });
  });
});
