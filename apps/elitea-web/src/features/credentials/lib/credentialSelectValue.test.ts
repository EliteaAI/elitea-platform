import { describe, expect, it } from 'vitest';

import {
  decodeCreateActionValue,
  decodeSavedCredentialValue,
  encodeCreateActionValue,
  encodeSavedCredentialValue,
  isBlankEliteaTitle,
} from './credentialSelectValue';

describe('isBlankEliteaTitle', () => {
  it.each([null, undefined, '', '   '])('is true for %p', (value) => {
    expect(isBlankEliteaTitle(value)).toBe(true);
  });

  it('is false for a real title', () => {
    expect(isBlankEliteaTitle('my-cred')).toBe(false);
  });
});

describe('saved-credential value codec (round trip)', () => {
  it('round-trips a private row', () => {
    const encoded = encodeSavedCredentialValue({ eliteaTitle: 'my-cred', isPrivate: true });
    expect(decodeSavedCredentialValue(encoded)).toEqual({ eliteaTitle: 'my-cred', private: true });
  });

  it('round-trips a shared (non-private) row', () => {
    const encoded = encodeSavedCredentialValue({ eliteaTitle: 'shared-cred', isPrivate: false });
    expect(decodeSavedCredentialValue(encoded)).toEqual({ eliteaTitle: 'shared-cred', private: false });
  });

  it('encodes a blank-title row as the empty string', () => {
    expect(encodeSavedCredentialValue({ eliteaTitle: '' })).toBe('');
    expect(encodeSavedCredentialValue(undefined)).toBe('');
  });

  it('decodes the empty string / null / undefined to null', () => {
    expect(decodeSavedCredentialValue('')).toBeNull();
    expect(decodeSavedCredentialValue(null)).toBeNull();
    expect(decodeSavedCredentialValue(undefined)).toBeNull();
  });

  it('decodes malformed JSON to null without throwing', () => {
    expect(decodeSavedCredentialValue('{not json')).toBeNull();
  });

  it('decodes a well-formed but foreign JSON object to null', () => {
    expect(decodeSavedCredentialValue(JSON.stringify({ some: 'thing' }))).toBeNull();
  });

  it('decodes a create-action payload to null (wrong kind)', () => {
    expect(decodeSavedCredentialValue(encodeCreateActionValue(true))).toBeNull();
  });

  it('decodes a saved payload with a non-string elitea_title to null', () => {
    expect(decodeSavedCredentialValue(JSON.stringify({ kind: 'saved', elitea_title: 42, private: true }))).toBeNull();
  });

  it('decodes a saved payload with a blank elitea_title to null', () => {
    expect(decodeSavedCredentialValue(JSON.stringify({ kind: 'saved', elitea_title: '   ', private: true }))).toBeNull();
  });
});

describe('create-action value codec (round trip)', () => {
  it('round-trips private and non-private', () => {
    expect(decodeCreateActionValue(encodeCreateActionValue(true))).toEqual({ isPrivate: true });
    expect(decodeCreateActionValue(encodeCreateActionValue(false))).toEqual({ isPrivate: false });
  });

  it('decodes empty/malformed/foreign-kind input to null', () => {
    expect(decodeCreateActionValue('')).toBeNull();
    expect(decodeCreateActionValue('{bad')).toBeNull();
    expect(decodeCreateActionValue(encodeSavedCredentialValue({ eliteaTitle: 'x' }))).toBeNull();
  });
});
