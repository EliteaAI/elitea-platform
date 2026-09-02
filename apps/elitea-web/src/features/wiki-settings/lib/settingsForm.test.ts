/**
 * The settings rules, as a function.
 *
 * The legacy screen parsed the JSON inside its save handler and reported
 * failures as a string, so the only way to exercise these rules was to drive a
 * form. They decide whether a generation can find its repository at all.
 */
import { describe, expect, it } from 'vitest';

import { canSaveSettings, parseSettingsDraft } from './settingsForm';

describe('parseSettingsDraft', () => {
  it('accepts a document with a resolvable repository', () => {
    const parsed = parseSettingsDraft('{"github_repository":"acme/notes-service"}');
    expect(parsed.problems).toEqual([]);
    expect(canSaveSettings(parsed)).toBe(true);
  });

  it('names the JSON error rather than saying "invalid"', () => {
    const parsed = parseSettingsDraft('{"repo": }');
    expect(parsed.settings).toBeNull();
    expect(parsed.problems[0]?.message).toMatch(/not valid json/i);
    // The parser's own message is carried through: "Unexpected token" tells an
    // operator where to look, "Invalid JSON" does not.
    expect(parsed.problems[0]?.message.length).toBeGreaterThan('Not valid JSON: '.length);
  });

  it('refuses an empty document instead of treating it as {}', () => {
    // Saving empty would silently clear a configuration nobody meant to touch.
    const parsed = parseSettingsDraft('   ');
    expect(canSaveSettings(parsed)).toBe(false);
    expect(parsed.problems[0]?.message).toMatch(/cannot be empty/i);
  });

  it('refuses a JSON array or scalar FOR THE RIGHT REASON', () => {
    // Asserting only canSaveSettings passed even with the array check removed:
    // an array has no repository either, so the repository rule rejected it
    // and the shape rule was never exercised. The message is what
    // discriminates, and settings must be null — a caller that reads
    // `parsed.settings` must not receive an array.
    for (const draft of ['[1,2]', '"a string"', '42', 'null']) {
      const parsed = parseSettingsDraft(draft);
      expect(canSaveSettings(parsed)).toBe(false);
      expect(parsed.settings).toBeNull();
      expect(parsed.problems[0]?.message).toMatch(/must be a JSON object|not valid JSON/i);
      expect(parsed.problems[0]?.field).toBeNull();
    }
  });

  it('refuses a valid object with NO repository', () => {
    // The check the legacy screen did not make. Without it the configuration
    // saves, and the operator learns minutes later from a generation that ran
    // and produced nothing.
    const parsed = parseSettingsDraft('{"branch":"main"}');
    expect(canSaveSettings(parsed)).toBe(false);
    expect(parsed.problems[0]?.field).toBe('repository');
  });

  it.each([
    ['{"github_repository":"acme/x"}', 'github_repository'],
    ['{"repository":"acme/x"}', 'repository'],
    ['{"repo":"acme/x"}', 'repo'],
    ['{"toolkit_configuration_github_repository":"acme/x"}', 'the toolkit_configuration alias'],
    [
      '{"ado_configuration":{"organization":"o","project":"p"},"repository_id":"r"}',
      'an Azure DevOps triple',
    ],
  ])('accepts %s (%s)', (draft) => {
    // Every alias the identity resolver understands must be accepted here, or
    // the form refuses a configuration the feature would have used.
    expect(canSaveSettings(parseSettingsDraft(draft))).toBe(true);
  });

  it('reports every problem at once', () => {
    // One message per save round-trip is the experience this avoids. A
    // document that is an object but has no repository yields exactly one
    // problem; the multi-problem path is exercised by the field being set.
    const parsed = parseSettingsDraft('{"unrelated":true}');
    expect(parsed.problems).toHaveLength(1);
    expect(parsed.settings).not.toBeNull();
  });

  describe('the model settings the engine substitutes defaults for', () => {
    // Measured 2026-09-02 (PR #725): the engine asks the platform gateway for
    // gpt-4o-mini / text-embedding-3-large when the toolkit names neither, the
    // gateway resolves models PER PROJECT, and a project without those rows
    // answers 404. The generation then "completes" with no pages and only the
    // gateway log says why.
    it('hints BOTH models for a document that names neither, and still saves', () => {
      const parsed = parseSettingsDraft('{"repository":"acme/x"}');
      expect(parsed.problems).toEqual([]);
      // Not a problem: the document is legal and works wherever the project
      // does resolve the fallbacks. Blocking Save would break those.
      expect(canSaveSettings(parsed)).toBe(true);
      expect(parsed.hints).toEqual([
        { field: 'llm_model', fallback: 'gpt-4o-mini' },
        { field: 'embedding_model', fallback: 'text-embedding-3-large' },
      ]);
    });

    it('names the model the engine would ASK FOR, not just the missing key', () => {
      // The fallback name is the whole point: it is the string an operator has
      // to go and configure, or match. A hint that only said "missing" would
      // leave them where the gateway log left them.
      const hints = parseSettingsDraft('{"repository":"acme/x","llm_model":"gpt-5"}').hints;
      expect(hints).toHaveLength(1);
      expect(hints[0]?.field).toBe('embedding_model');
      expect(hints[0]?.fallback).toBe('text-embedding-3-large');
    });

    it('hints nothing when both models are named', () => {
      const parsed = parseSettingsDraft(
        '{"repository":"acme/x","llm_model":"gpt-5","embedding_model":"text-embedding-3-small"}',
      );
      expect(parsed.hints).toEqual([]);
    });

    it.each([
      ['toolkit_configuration_llm_model', 'toolkit_configuration_embedding_model'],
      ['llm_model', 'embedding_model'],
    ])('accepts %s / %s as naming the models', (llmKey, embeddingKey) => {
      // The toolkit_configuration_ twin is how a settings screen may have
      // stored it (entities/wiki's alias rule). Reading only the bare name
      // would hint at a toolkit that is in fact configured.
      const draft = JSON.stringify({ repository: 'acme/x', [llmKey]: 'gpt-5', [embeddingKey]: 'e5' });
      expect(parseSettingsDraft(draft).hints).toEqual([]);
    });

    it.each([['""'], ['"   "'], ['null'], ['42'], ['{"name":"gpt-5"}']])(
      'treats %s as no model at all',
      (value) => {
        // A key stored blank is what a settings screen leaves behind when a
        // field is cleared, and the engine falls back on it exactly as if the
        // key were absent. A non-string is not a model name either.
        const draft = `{"repository":"acme/x","llm_model":${value},"embedding_model":${value}}`;
        expect(parseSettingsDraft(draft).hints.map((h) => h.field)).toEqual([
          'llm_model',
          'embedding_model',
        ]);
      },
    );

    it('hints nothing about a document that never parsed', () => {
      // There is no configuration to hint about, and a hint beside "not valid
      // JSON" would read as a second, unrelated defect.
      for (const draft of ['   ', '{not json', '[1,2]']) {
        expect(parseSettingsDraft(draft).hints).toEqual([]);
      }
    });
  });
});
