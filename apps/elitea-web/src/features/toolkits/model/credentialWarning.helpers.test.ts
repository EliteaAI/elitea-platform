import { describe, expect, it } from 'vitest';

import { hasCredentialConfigChanged, revertCredentialFields } from './credentialWarning.helpers';

describe('hasCredentialConfigChanged', () => {
  it('returns false when there is no settings at all', () => {
    expect(hasCredentialConfigChanged(undefined, undefined)).toBe(false);
    expect(hasCredentialConfigChanged({}, {})).toBe(false);
  });

  it('returns false when a credential-like field is unchanged', () => {
    const cred = { url: { elitea_title: 'Shared', private: false } };
    expect(hasCredentialConfigChanged({ settings: cred }, { settings: cred })).toBe(false);
  });

  it('returns true when a credential field flips from shared to private', () => {
    const current = { settings: { url: { elitea_title: 'Shared', private: true } } };
    const original = { settings: { url: { elitea_title: 'Shared', private: false } } };
    expect(hasCredentialConfigChanged(current, original)).toBe(true);
  });

  it('returns true when the elitea_title itself changes', () => {
    const current = { settings: { url: { elitea_title: 'New', private: false } } };
    const original = { settings: { url: { elitea_title: 'Shared', private: false } } };
    expect(hasCredentialConfigChanged(current, original)).toBe(true);
  });

  it('ignores a non-credential-shaped settings value', () => {
    const current = { settings: { name: 'plain string' } };
    const original = { settings: { name: 'plain string' } };
    expect(hasCredentialConfigChanged(current, original)).toBe(false);
  });

  it('ignores a field with no matching original elitea_title', () => {
    const current = { settings: { url: { elitea_title: 'New', private: false } } };
    const original = { settings: { url: {} } };
    expect(hasCredentialConfigChanged(current, original)).toBe(false);
  });
});

describe('revertCredentialFields', () => {
  it('returns editToolDetail unchanged when originalDetails is missing', () => {
    const editToolDetail = { settings: { a: 1 } };
    expect(revertCredentialFields(editToolDetail, undefined)).toBe(editToolDetail);
  });

  it('returns undefined unchanged when editToolDetail is missing', () => {
    expect(revertCredentialFields(undefined, { settings: {} })).toBeUndefined();
  });

  it('reverts only the changed credential field', () => {
    const current = { settings: { url: { elitea_title: 'New', private: true }, other: 'keep-me' } };
    const original = { settings: { url: { elitea_title: 'Shared', private: false } } };
    const result = revertCredentialFields(current, original);
    expect(result?.settings?.url).toEqual({ elitea_title: 'Shared', private: false });
    expect(result?.settings?.other).toBe('keep-me');
  });

  it('leaves an unchanged credential field as-is', () => {
    const cred = { elitea_title: 'Shared', private: false };
    const current = { settings: { url: cred } };
    const original = { settings: { url: cred } };
    const result = revertCredentialFields(current, original);
    expect(result?.settings?.url).toBe(cred);
  });
});
