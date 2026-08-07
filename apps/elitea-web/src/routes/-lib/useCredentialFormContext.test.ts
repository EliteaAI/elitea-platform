import { describe, expect, it } from 'vitest';

import { PERMISSIONS } from '@/shared/lib/permissions';

import { deriveCredentialFormContext, selectPersonalProjectId } from './useCredentialFormContext';

const UPDATE = PERMISSIONS.configuration.update;
const DELETE = PERMISSIONS.configuration.delete;
const NONE: ReadonlySet<string> = new Set();
const BOTH: ReadonlySet<string> = new Set([UPDATE, DELETE]);

describe('selectPersonalProjectId (pure)', () => {
  it('reads auth.getUser().personal_project_id when present', () => {
    expect(selectPersonalProjectId({ auth: { getUser: () => ({ personal_project_id: 'p-9' }) } })).toBe('p-9');
  });

  it('returns undefined for every not-yet-wired context shape', () => {
    expect(selectPersonalProjectId({ auth: { getUser: () => undefined } })).toBeUndefined();
    expect(selectPersonalProjectId({ auth: {} })).toBeUndefined();
    expect(selectPersonalProjectId({})).toBeUndefined();
    expect(selectPersonalProjectId(undefined)).toBeUndefined();
    expect(selectPersonalProjectId(null)).toBeUndefined();
    expect(selectPersonalProjectId('nope')).toBeUndefined();
  });
});

describe('deriveCredentialFormContext — permissions fail closed', () => {
  it('grants update/delete only when the permission set actually carries them', () => {
    const context = deriveCredentialFormContext('7', 'p-9', BOTH);
    expect(context.canUpdate).toBe(true);
    expect(context.canDelete).toBe(true);
  });

  it('denies BOTH while the permission set is still empty (not yet loaded)', () => {
    // The important direction: an unloaded permission set must not briefly
    // present an enabled Save/Delete. Matches ProtectedRoute.jsx's own
    // "no permissions yet -> don't render the privileged branch" default.
    const context = deriveCredentialFormContext('7', 'p-9', NONE);
    expect(context.canUpdate).toBe(false);
    expect(context.canDelete).toBe(false);
  });

  it('grants each permission independently — update does not imply delete', () => {
    const updateOnly = deriveCredentialFormContext('7', 'p-9', new Set([UPDATE]));
    expect(updateOnly.canUpdate).toBe(true);
    expect(updateOnly.canDelete).toBe(false);

    const deleteOnly = deriveCredentialFormContext('7', 'p-9', new Set([DELETE]));
    expect(deleteOnly.canUpdate).toBe(false);
    expect(deleteOnly.canDelete).toBe(true);
  });

  it('ignores unrelated permissions', () => {
    const context = deriveCredentialFormContext('7', 'p-9', new Set([PERMISSIONS.secrets.edit, 'some.other.grant']));
    expect(context.canUpdate).toBe(false);
    expect(context.canDelete).toBe(false);
  });
});

describe('deriveCredentialFormContext — isTeamProject fails closed', () => {
  it('is true only when a known selected project differs from a known personal one', () => {
    expect(deriveCredentialFormContext('7', 'p-9', NONE).isTeamProject).toBe(true);
  });

  it('is false when the selected project IS the personal project', () => {
    expect(deriveCredentialFormContext('p-9', 'p-9', NONE).isTeamProject).toBe(false);
  });

  it('is false while the selected project is unknown', () => {
    // `''` is the store's "nothing selected yet" value, not a real id — it
    // must not read as "a team project that happens not to be personal".
    expect(deriveCredentialFormContext('', 'p-9', NONE).isTeamProject).toBe(false);
  });

  it('is false while the personal project is unknown', () => {
    // Router auth context not hydrated yet: with nothing to compare against,
    // "not personal" is unknowable, so it must not default to true.
    expect(deriveCredentialFormContext('7', undefined, NONE).isTeamProject).toBe(false);
  });

  it('is false when neither id is known', () => {
    expect(deriveCredentialFormContext('', undefined, NONE).isTeamProject).toBe(false);
  });
});

describe('deriveCredentialFormContext — shape', () => {
  it('passes projectId through verbatim, including the empty sentinel', () => {
    expect(deriveCredentialFormContext('7', undefined, NONE).projectId).toBe('7');
    expect(deriveCredentialFormContext('', undefined, NONE).projectId).toBe('');
  });

  it('omits personalProjectId entirely rather than setting it undefined', () => {
    // exactOptionalPropertyTypes: an absent optional and an explicit
    // `undefined` are different types here, and the consumer's
    // `CredentialFormContext` declares the former.
    const context = deriveCredentialFormContext('7', undefined, NONE);
    expect('personalProjectId' in context).toBe(false);
  });

  it('includes personalProjectId when known', () => {
    expect(deriveCredentialFormContext('7', 'p-9', NONE).personalProjectId).toBe('p-9');
  });
});
