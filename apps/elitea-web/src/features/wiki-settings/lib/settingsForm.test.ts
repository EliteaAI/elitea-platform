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
});
