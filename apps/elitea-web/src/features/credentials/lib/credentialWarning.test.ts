import { describe, expect, it } from 'vitest';

import { hasCredentialConfigChanged, revertCredentialFields } from './credentialWarning';

describe('hasCredentialConfigChanged', () => {
  it('is false when current/original are undefined', () => {
    expect(hasCredentialConfigChanged(undefined, undefined)).toBe(false);
  });

  it('is false when no settings entry looks like a credential reference', () => {
    expect(
      hasCredentialConfigChanged({ settings: { name: 'x' } }, { settings: { name: 'y' } }),
    ).toBe(false);
  });

  it('is true when a credential entry changed private flag', () => {
    const current = { settings: { cred: { elitea_title: 'a', private: true } } };
    const original = { settings: { cred: { elitea_title: 'a', private: false } } };
    expect(hasCredentialConfigChanged(current, original)).toBe(true);
  });

  it('is true when a credential entry changed elitea_title', () => {
    const current = { settings: { cred: { elitea_title: 'b', private: false } } };
    const original = { settings: { cred: { elitea_title: 'a', private: false } } };
    expect(hasCredentialConfigChanged(current, original)).toBe(true);
  });

  it('is false when the original entry has no elitea_title (nothing to compare against)', () => {
    const current = { settings: { cred: { elitea_title: 'a', private: false } } };
    const original = { settings: { cred: {} } };
    expect(hasCredentialConfigChanged(current, original)).toBe(false);
  });

  it('is false when unchanged', () => {
    const current = { settings: { cred: { elitea_title: 'a', private: false } } };
    const original = { settings: { cred: { elitea_title: 'a', private: false } } };
    expect(hasCredentialConfigChanged(current, original)).toBe(false);
  });
});

describe('revertCredentialFields', () => {
  it('returns editToolDetail unchanged when originalDetails is missing', () => {
    const edit = { settings: { a: 1 } };
    expect(revertCredentialFields(edit, undefined)).toBe(edit);
  });

  it('reverts only the changed credential fields, leaving others intact', () => {
    const current = {
      settings: {
        cred: { elitea_title: 'b', private: true },
        other: 'unchanged',
      },
    };
    const original = {
      settings: {
        cred: { elitea_title: 'a', private: false },
        other: 'unchanged',
      },
    };
    const result = revertCredentialFields(current, original);
    expect(result?.settings?.['cred']).toEqual({ elitea_title: 'a', private: false });
    expect(result?.settings?.['other']).toBe('unchanged');
  });

  it('leaves non-credential-shaped or unchanged entries untouched', () => {
    const current = { settings: { name: 'x', cred: { elitea_title: 'a', private: false } } };
    const original = { settings: { name: 'y', cred: { elitea_title: 'a', private: false } } };
    const result = revertCredentialFields(current, original);
    expect(result?.settings).toEqual({ name: 'x', cred: { elitea_title: 'a', private: false } });
  });
});
