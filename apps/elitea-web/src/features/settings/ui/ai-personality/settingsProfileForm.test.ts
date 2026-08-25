/**
 * The shared form model. Three properties are load-bearing and invisible in
 * the UI:
 *
 *  1. per-persona instructions survive the round trip, and every persona key
 *     exists on the way in even when the stored map is partial;
 *  2. the payload nests context-management/summarization INSIDE
 *     `personalization` — the Go handler reads no other top-level key, so a
 *     flat payload would save nothing (see the module header);
 *  3. the payload carries forward what the page does not edit. The upsert
 *     replaces `personalization` wholesale and re-writes
 *     `name`/`description`/`avatar` from the body, so a partial payload is
 *     silent data loss for the OTHER page's settings and for the avatar.
 */
import { describe, expect, it } from 'vitest';

import {
  buildAuthorUpdate,
  deserializeSettingsProfile,
  serializeSettingsProfile,
} from './settingsProfileForm';

describe('serializeSettingsProfile', () => {
  it('merges a partial stored instructions map over an empty slot for every persona', () => {
    const values = serializeSettingsProfile({
      personalization: { persona: 'qa', personality_instructions: { qa: 'be terse' } },
    });

    expect(values.persona).toBe('qa');
    expect(values.personality_instructions).toEqual({
      generic: '',
      qa: 'be terse',
      nerdy: '',
      quirky: '',
      cynical: '',
      none: '',
      bare: '',
    });
  });

  it('defaults to the `generic` persona and empty slots when the profile has no personalization', () => {
    const values = serializeSettingsProfile(undefined);

    expect(values.persona).toBe('generic');
    expect(Object.values(values.personality_instructions).every((slot) => slot === '')).toBe(true);
  });

  it('reads the context-management and summarization blocks from inside personalization', () => {
    const values = serializeSettingsProfile({
      personalization: {
        default_context_management: {
          enabled: false,
          max_context_tokens: 12_345,
          preserve_recent_messages: 9,
          enable_context_editing: true,
        },
        default_summarization: {
          enable_summarization: false,
          summary_instructions: 'short please',
          summary_model_name: 'gpt-4o',
          summary_model_project_id: '7',
          target_summary_tokens: 512,
        },
      },
    });

    expect(values.context_enabled).toBe(false);
    expect(values.max_context_tokens).toBe(12_345);
    expect(values.preserve_recent_messages).toBe(9);
    expect(values.enable_context_editing).toBe(true);
    expect(values.enable_summarization).toBe(false);
    expect(values.summary_llm_settings).toEqual({
      instructions: 'short please',
      model_name: 'gpt-4o',
      model_project_id: '7',
      max_tokens: 512,
    });
  });

  it('falls back to the selected project as the summary model owner when none is stored', () => {
    const values = serializeSettingsProfile({ personalization: {} }, 'proj-9');

    expect(values.summary_llm_settings.model_project_id).toBe('proj-9');
  });
});

describe('deserializeSettingsProfile', () => {
  it('round-trips the full per-persona map, not just the selected persona', () => {
    const instructions = { generic: 'g', qa: 'q', nerdy: '', quirky: '', cynical: '', none: '', bare: '' };
    const values = { ...serializeSettingsProfile(undefined), persona: 'qa', personality_instructions: instructions };

    const payload = deserializeSettingsProfile(values);

    expect(payload.persona).toBe('qa');
    expect(payload.personality_instructions).toEqual(instructions);
  });

  it('nests the memory settings under personalization keys the handler actually reads', () => {
    const values = {
      ...serializeSettingsProfile(undefined),
      context_enabled: true,
      max_context_tokens: 1000,
      preserve_recent_messages: 3,
      enable_context_editing: true,
      enable_summarization: true,
      summary_llm_settings: { instructions: 'i', model_name: 'm', model_project_id: '2', max_tokens: 256 },
    };

    expect(deserializeSettingsProfile(values)).toMatchObject({
      default_context_management: {
        enabled: true,
        max_context_tokens: 1000,
        preserve_recent_messages: 3,
        enable_context_editing: true,
      },
      default_summarization: {
        enable_summarization: true,
        summary_instructions: 'i',
        summary_model_name: 'm',
        summary_model_project_id: '2',
        target_summary_tokens: 256,
      },
    });
  });
});

describe('buildAuthorUpdate', () => {
  it('keeps personalization keys neither page edits, and the profile fields the upsert would blank', () => {
    const author = {
      name: 'Ada',
      description: 'about me',
      avatar: 'avatar.png',
      personalization: {
        persona: 'generic',
        // Owned by a different page; the PUT replaces the whole blob.
        default_internal_mcp_enabled: false,
        some_future_setting: { nested: true },
      },
    };
    const values = { ...serializeSettingsProfile(author), persona: 'nerdy' };

    const payload = buildAuthorUpdate(author, values);

    expect(payload.name).toBe('Ada');
    expect(payload.description).toBe('about me');
    expect(payload.avatar).toBe('avatar.png');
    expect(payload.personalization).toMatchObject({
      persona: 'nerdy',
      default_internal_mcp_enabled: false,
      some_future_setting: { nested: true },
    });
  });

  it('omits profile fields the fetched author does not carry, rather than sending empty strings', () => {
    const payload = buildAuthorUpdate(undefined, serializeSettingsProfile(undefined));

    expect('name' in payload).toBe(false);
    expect('avatar' in payload).toBe(false);
  });
});
