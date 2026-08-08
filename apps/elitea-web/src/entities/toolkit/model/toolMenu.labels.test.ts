/**
 * A toolkit tile's label is its ONLY accessible name, so an empty label is a
 * critical axe `button-name` violation rather than a cosmetic gap.
 *
 * This was found by E2E (J17), not by a unit test, and only AFTER the backend
 * catalogue was fixed to serve real types (#129). Before that the page rendered
 * two nameless tiles for the `rows`/`total` keys of a pagination envelope; once
 * real types arrived it rendered two nameless tiles for `database` and
 * `datasource` instead. Same symptom, completely different cause — which is why
 * this pins the INVARIANT (no entry may be nameless) rather than those two keys.
 *
 * The backend's type schemas carry no `metadata.label` at all — measured
 * against the running stack, every type returns `metadata: {}` — so the label
 * came solely from the frontend `ToolTypes` override map. Any type the backend
 * adds without a matching frontend release therefore had an empty name.
 */
import { describe, expect, it } from 'vitest';

import { toolkitTypeMenuEntries } from './toolMenu';

/** The exact shape the catalogue returns: a type key -> schema, metadata empty. */
function catalogue(...keys: string[]): Record<string, Record<string, unknown>> {
  return Object.fromEntries(keys.map((k) => [k, { metadata: {} }]));
}

describe('toolkitTypeMenuEntries labelling', () => {
  it('never yields an entry with an empty label, whatever the backend sends', () => {
    // Includes the two real keys that regressed (database, datasource), one the
    // override map knows (github), and one no frontend has ever heard of.
    const entries = toolkitTypeMenuEntries(
      catalogue('github', 'database', 'datasource', 'some_future_toolkit'),
    );

    expect(entries.length).toBe(4);
    for (const entry of entries) {
      expect(entry.label, `type "${entry.key}" produced an empty accessible name`).not.toBe('');
      expect(entry.label.trim(), `type "${entry.key}" produced a whitespace-only name`).not.toBe('');
    }
  });

  it('humanises an unknown key instead of falling back to nothing', () => {
    const entries = toolkitTypeMenuEntries(catalogue('database', 'some_future_toolkit'));
    const byKey = Object.fromEntries(entries.map((e) => [e.key, e.label]));

    expect(byKey['database']).toBe('Database');
    // Underscores become spaces and each word is capitalised, so a key the
    // frontend has never seen still reads as a name rather than as an id.
    expect(byKey['some_future_toolkit']).toBe('Some Future Toolkit');
  });

  it('still prefers the frontend override when one exists', () => {
    // Guards the fallback from swallowing the curated labels: `github` must not
    // degrade to the humanised "Github".
    const entries = toolkitTypeMenuEntries(catalogue('github'));
    expect(entries[0]?.label).toBe('GitHub');
  });

  it('prefers a backend label over the humanised key when the backend supplies one', () => {
    // Not currently exercised in production (metadata is empty today), but the
    // precedence is part of the contract and would otherwise be untested.
    const entries = toolkitTypeMenuEntries({
      unknown_type: { metadata: { label: 'Backend Supplied' } },
    });
    expect(entries[0]?.label).toBe('Backend Supplied');
  });
});
