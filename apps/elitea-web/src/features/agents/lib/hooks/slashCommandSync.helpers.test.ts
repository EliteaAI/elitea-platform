import { describe, expect, it, vi } from 'vitest';

import { MentionPhase, type MentionPhaseValue } from '../constants/mention.constants';
import {
  syncIdlePhase,
  syncItemsPhase,
  syncToolsPhase,
  type CommittedMention,
  type SelectedMentionItem,
  type SlashSyncActions,
} from './slashCommandSync.helpers';

interface ActionsHarness {
  readonly actions: SlashSyncActions;
  readonly calls: {
    uncommitByName: string[];
    setSelectedItem: (SelectedMentionItem | null)[];
    setItemQuery: string[];
    setToolQuery: string[];
    setPhaseTo: string[];
    resetSlash: number;
  };
}

function makeActions(options?: {
  readonly committedMentions?: readonly CommittedMention[];
  readonly mentionAnchor?: number | null;
  readonly selectedItem?: SelectedMentionItem | null;
}): ActionsHarness {
  const calls: ActionsHarness['calls'] = {
    uncommitByName: [],
    setSelectedItem: [],
    setItemQuery: [],
    setToolQuery: [],
    setPhaseTo: [],
    resetSlash: 0,
  };
  const mentionAnchorRef = { current: options?.mentionAnchor ?? null };
  const actions: SlashSyncActions = {
    committedMentionsRef: { current: options?.committedMentions ?? [] },
    mentionAnchorRef,
    selectedItem: options?.selectedItem ?? null,
    uncommitByName: vi.fn((name: string) => calls.uncommitByName.push(name)),
    setSelectedItem: vi.fn((item: SelectedMentionItem | null) => calls.setSelectedItem.push(item)),
    setItemQuery: vi.fn((value: string) => calls.setItemQuery.push(value)),
    setToolQuery: vi.fn((value: string) => calls.setToolQuery.push(value)),
    setPhaseTo: vi.fn((phase: MentionPhaseValue) => calls.setPhaseTo.push(phase)),
    resetSlash: vi.fn(() => {
      calls.resetSlash += 1;
    }),
  };
  return { actions, calls };
}

describe('syncIdlePhase', () => {
  it('re-opens a committed mention on a "/Name/Tool" full match and sets the anchor when unset', () => {
    const { actions, calls } = makeActions({
      committedMentions: [{ name: 'Github', tool_name: null }],
      mentionAnchor: null,
    });
    const text = 'use /Github/is';
    syncIdlePhase(text, text.length, actions);

    expect(calls.uncommitByName).toStrictEqual(['Github']);
    expect(calls.setSelectedItem).toStrictEqual([{ name: 'Github' }]);
    expect(calls.setItemQuery).toStrictEqual(['Github']);
    expect(calls.setToolQuery).toStrictEqual(['is']);
    expect(calls.setPhaseTo).toStrictEqual([MentionPhase.Tools]);
    expect(actions.mentionAnchorRef.current).toBe(text.length - '/Github/is'.length);
  });

  it('does not overwrite an already-set mentionAnchorRef on a full match', () => {
    const { actions } = makeActions({
      committedMentions: [{ name: 'Github', tool_name: null }],
      mentionAnchor: 3,
    });
    const text = '/Github/is';
    syncIdlePhase(text, text.length, actions);
    expect(actions.mentionAnchorRef.current).toBe(3);
  });

  it('full match with no committed name match takes no action (does not fall through to fallback search)', () => {
    const { actions, calls } = makeActions({ committedMentions: [{ name: 'Other', tool_name: null }] });
    const text = '/Github/is';
    syncIdlePhase(text, text.length, actions);
    expect(calls.uncommitByName).toStrictEqual([]);
    expect(calls.setItemQuery).toStrictEqual([]);
    expect(actions.mentionAnchorRef.current).toBeNull();
  });

  it('re-opens a committed mention on a bare "/Name" prefix match (case-insensitive startsWith)', () => {
    const { actions, calls } = makeActions({
      committedMentions: [{ name: 'Github', tool_name: 'issue' }],
      mentionAnchor: null,
    });
    const text = 'use /git';
    syncIdlePhase(text, text.length, actions);

    expect(calls.uncommitByName).toStrictEqual(['Github']);
    expect(calls.setItemQuery).toStrictEqual(['git']);
    expect(calls.setPhaseTo).toStrictEqual([MentionPhase.Items]);
    expect(actions.mentionAnchorRef.current).toBe(text.length - '/git'.length);
  });

  it('an empty bare "/" match (name.length === 0) takes no action', () => {
    const { actions, calls } = makeActions({ committedMentions: [{ name: 'Github', tool_name: null }] });
    const text = 'use /';
    syncIdlePhase(text, text.length, actions);
    expect(calls.uncommitByName).toStrictEqual([]);
    expect(actions.mentionAnchorRef.current).toBeNull();
  });

  it('a bare "/Name" match with no committed prefix match takes no action', () => {
    const { actions, calls } = makeActions({ committedMentions: [{ name: 'Slack', tool_name: null }] });
    const text = 'use /git';
    syncIdlePhase(text, text.length, actions);
    expect(calls.uncommitByName).toStrictEqual([]);
  });

  it('fallback search recovers a backspace into a multi-word committed mention name (no tool)', () => {
    // A bare "/Name" or "/Name/Tool" regex match never fires here: the mention's own name
    // contains a space ("Slack Bot"), which breaks both FULL_MATCH_RE and ITEM_ONLY_RE, so
    // syncIdlePhase falls through to the byte-by-byte fallback search.
    const { actions, calls } = makeActions({
      committedMentions: [{ name: 'Slack Bot', tool_name: null }],
    });
    const text = 'Use /Slack Bot';
    syncIdlePhase(text, text.length, actions);

    expect(calls.uncommitByName).toStrictEqual(['Slack Bot']);
    expect(calls.setItemQuery).toStrictEqual(['Slack Bot']);
    expect(calls.setPhaseTo).toStrictEqual([MentionPhase.Items]);
    expect(actions.mentionAnchorRef.current).toBe(text.length - '/Slack Bot'.length);
  });

  it('fallback search breaks (and reports no match) when the candidate is not preceded by a word boundary', () => {
    const { actions, calls } = makeActions({ committedMentions: [{ name: 'Slack Bot', tool_name: null }] });
    const text = 'x/Slack Bot';
    syncIdlePhase(text, text.length, actions);
    expect(calls.uncommitByName).toStrictEqual([]);
    expect(calls.resetSlash).toBe(0);
    expect(actions.mentionAnchorRef.current).toBeNull();
  });
});

describe('syncItemsPhase', () => {
  it('anchored + internal "/" separator + selectedItem set -> updates itemQuery and moves to Tools phase', () => {
    const text = 'use /Github/is';
    const anchor = text.indexOf('/Github');
    const { actions, calls } = makeActions({ mentionAnchor: anchor, selectedItem: { name: 'Github' } });
    syncItemsPhase(text, text.length, actions);
    expect(calls.setItemQuery).toStrictEqual(['Github']);
    expect(calls.setToolQuery).toStrictEqual(['is']);
    expect(calls.setPhaseTo).toStrictEqual([MentionPhase.Tools]);
  });

  it('anchored + internal "/" separator + no selectedItem -> only updates itemQuery, stays in Items', () => {
    const text = 'use /Github/is';
    const anchor = text.indexOf('/Github');
    const { actions, calls } = makeActions({ mentionAnchor: anchor, selectedItem: null });
    syncItemsPhase(text, text.length, actions);
    expect(calls.setItemQuery).toStrictEqual(['Github']);
    expect(calls.setToolQuery).toStrictEqual([]);
    expect(calls.setPhaseTo).toStrictEqual([]);
  });

  it('anchored + trailing space after the item name -> resets the slash state', () => {
    const text = 'use /Github ';
    const anchor = text.indexOf('/Github');
    const { actions, calls } = makeActions({ mentionAnchor: anchor });
    syncItemsPhase(text, text.length, actions);
    expect(calls.resetSlash).toBe(1);
  });

  it('anchored + newline after the item name -> resets the slash state', () => {
    const text = 'use /Github\nmore';
    const anchor = text.indexOf('/Github');
    const { actions, calls } = makeActions({ mentionAnchor: anchor });
    syncItemsPhase(text, text.length, actions);
    expect(calls.resetSlash).toBe(1);
  });

  it('anchored + plain partial name -> updates itemQuery only', () => {
    const text = 'use /Git';
    const anchor = text.indexOf('/Git');
    const { actions, calls } = makeActions({ mentionAnchor: anchor });
    syncItemsPhase(text, text.length, actions);
    expect(calls.setItemQuery).toStrictEqual(['Git']);
    expect(calls.resetSlash).toBe(0);
  });

  it('anchor points at a stale position (text[anchor] !== "/") -> falls through to fresh regex matching', () => {
    const text = 'use /Git';
    const { actions, calls } = makeActions({ mentionAnchor: 0, selectedItem: null });
    syncItemsPhase(text, text.length, actions);
    expect(calls.setItemQuery).toStrictEqual(['Git']);
  });

  it('unanchored full "/Name/Tool" match + selectedItem set -> Tools phase', () => {
    const text = '/Github/is';
    const { actions, calls } = makeActions({ mentionAnchor: null, selectedItem: { name: 'Github' } });
    syncItemsPhase(text, text.length, actions);
    expect(calls.setItemQuery).toStrictEqual(['Github']);
    expect(calls.setToolQuery).toStrictEqual(['is']);
    expect(calls.setPhaseTo).toStrictEqual([MentionPhase.Tools]);
  });

  it('unanchored full "/Name/Tool" match + no selectedItem -> only itemQuery updates', () => {
    const text = '/Github/is';
    const { actions, calls } = makeActions({ mentionAnchor: null, selectedItem: null });
    syncItemsPhase(text, text.length, actions);
    expect(calls.setItemQuery).toStrictEqual(['Github']);
    expect(calls.setPhaseTo).toStrictEqual([]);
  });

  it('unanchored bare "/Name" match sets the anchor when unset', () => {
    const text = '/Git';
    const { actions, calls } = makeActions({ mentionAnchor: null });
    syncItemsPhase(text, text.length, actions);
    expect(calls.setItemQuery).toStrictEqual(['Git']);
    expect(actions.mentionAnchorRef.current).toBe(0);
  });

  it('no match at all -> resets the slash state', () => {
    const text = 'no mention here';
    const { actions, calls } = makeActions();
    syncItemsPhase(text, text.length, actions);
    expect(calls.resetSlash).toBe(1);
  });
});

describe('syncToolsPhase', () => {
  it('resets when there is no selectedItem', () => {
    const { actions, calls } = makeActions({ selectedItem: null });
    syncToolsPhase('/Github/is', 10, actions);
    expect(calls.resetSlash).toBe(1);
  });

  it('updates the tool query while inside the toolkit prefix with no trailing space/slash', () => {
    const text = '/Github/is';
    const { actions, calls } = makeActions({ selectedItem: { name: 'Github' } });
    syncToolsPhase(text, text.length, actions);
    expect(calls.setToolQuery).toStrictEqual(['is']);
    expect(calls.resetSlash).toBe(0);
  });

  it('resets when the tool query part contains a space', () => {
    const text = '/Github/is sue';
    const { actions, calls } = makeActions({ selectedItem: { name: 'Github' } });
    syncToolsPhase(text, text.length, actions);
    expect(calls.resetSlash).toBe(1);
    expect(calls.setToolQuery).toStrictEqual([]);
  });

  it('resets when the tool query part contains another slash', () => {
    const text = '/Github/is/sue';
    const { actions, calls } = makeActions({ selectedItem: { name: 'Github' } });
    syncToolsPhase(text, text.length, actions);
    expect(calls.resetSlash).toBe(1);
  });

  it('falls back to Items phase when the name is present with no trailing separator (deleted the "/")', () => {
    const text = '/Github';
    const { actions, calls } = makeActions({ selectedItem: { name: 'Github' } });
    syncToolsPhase(text, text.length, actions);
    expect(calls.setItemQuery).toStrictEqual(['Github']);
    expect(calls.setPhaseTo).toStrictEqual([MentionPhase.Items]);
  });

  it('recovers via the backspace loop when neither the prefix nor the bare name is intact, and sets the anchor', () => {
    const text = 'use /Git';
    const { actions, calls } = makeActions({ selectedItem: { name: 'Github' } });
    syncToolsPhase(text, text.length, actions);
    expect(calls.uncommitByName).toStrictEqual(['Github']);
    expect(calls.setItemQuery).toStrictEqual(['Git']);
    expect(calls.setPhaseTo).toStrictEqual([MentionPhase.Items]);
    expect(actions.mentionAnchorRef.current).toBe(text.length - '/Git'.length);
  });

  it('resets when the recovery loop finds no matching candidate at all', () => {
    const text = 'nothing matches here';
    const { actions, calls } = makeActions({ selectedItem: { name: 'Github' } });
    syncToolsPhase(text, text.length, actions);
    expect(calls.resetSlash).toBe(1);
    expect(calls.uncommitByName).toStrictEqual([]);
  });

  it('recovery loop uses `selectedItem?.name ?? ""` when uncommitting (defensive optional chaining branch)', () => {
    // selectedItem is guaranteed non-null by the earlier guard, but exercise the recovery path
    // itself thoroughly: a two-character-minimum candidate still triggers uncommit.
    const text = 'x /Gi';
    const { actions, calls } = makeActions({ selectedItem: { name: 'Github' } });
    syncToolsPhase(text, text.length, actions);
    expect(calls.uncommitByName).toStrictEqual(['Github']);
    expect(calls.setItemQuery).toStrictEqual(['Gi']);
  });
});
