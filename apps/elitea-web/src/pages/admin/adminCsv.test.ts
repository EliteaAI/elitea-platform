/**
 * Serialisation guards for the two admin CSV exports.
 *
 * Every property here is one a "does a file download?" assertion cannot see: a
 * mis-quoted comma still downloads, and a formula cell still downloads — it
 * just executes when the operator opens it.
 */
import { describe, expect, it } from 'vitest';

import { toCsvField } from './adminCsv';
import { buildAdminProjectsCsv } from './adminProjectsCsv';
import { buildAdminUsersCsv } from './adminUsersCsv';
import type { AdminProjectRow } from './api/adminProjectsApi';
import type { AdminUserRow } from './api/adminUsersApi';

function row(overrides: Partial<AdminUserRow> = {}): AdminUserRow {
  return {
    id: 1,
    name: 'Ada Admin',
    email: 'ada@example.com',
    last_login: '2026-08-01T10:00:00',
    suspended: false,
    is_admin: true,
    admin_role: 'admin',
    ...overrides,
  };
}

describe('toCsvField', () => {
  it('quotes and doubles per RFC 4180', () => {
    expect(toCsvField('plain')).toBe('plain');
    expect(toCsvField('Doe, Jane')).toBe('"Doe, Jane"');
    expect(toCsvField('Ada "Ace"')).toBe('"Ada ""Ace"""');
    expect(toCsvField('two\nlines')).toBe('"two\nlines"');
  });

  it('neutralises a cell Excel would execute as a formula', () => {
    // A display name arrives from SSO/SCIM, so it is attacker-controlled.
    expect(toCsvField('=HYPERLINK("http://evil","click")')).toBe(
      '"\'=HYPERLINK(""http://evil"",""click"")"',
    );
    expect(toCsvField('+1 555 0100')).toBe("'+1 555 0100");
    expect(toCsvField('-Minus')).toBe("'-Minus");
    expect(toCsvField('@handle')).toBe("'@handle");
  });
});

function project(overrides: Partial<AdminProjectRow> = {}): AdminProjectRow {
  return {
    id: 7,
    name: 'Alpha',
    owner_id: 3,
    owner_name: 'Ada Admin',
    admin_names: ['Bo Blocked', 'Cy Coder'],
    status: 'active',
    suspended: false,
    create_success: true,
    is_personal: false,
    ...overrides,
  };
}

describe('buildAdminProjectsCsv', () => {
  it('writes the reference page\u2019s five columns, admins joined into one cell', () => {
    const csv = buildAdminProjectsCsv([
      project(),
      project({ id: 8, name: 'Beta, Ltd', owner_name: '', admin_names: [], status: 'suspended' }),
    ]);

    expect(csv.split('\r\n')).toEqual([
      'Name,ID,Owner,Admins,Status',
      // The joined admin list contains a comma, so the CELL must be quoted —
      // unquoted it would shift Status into a column of its own.
      'Alpha,7,Ada Admin,"Bo Blocked, Cy Coder",Active',
      '"Beta, Ltd",8,,,Suspended',
    ]);
  });

  it('renders a failed provisioning run as its own status, not as Active', () => {
    expect(buildAdminProjectsCsv([project({ status: 'failed' })])).toContain(',Failed');
  });
});

describe('buildAdminUsersCsv', () => {
  it('writes the header and one CRLF-terminated line per user', () => {
    const csv = buildAdminUsersCsv([row(), row({ name: 'Bo Blocked', email: 'bo@example.com', last_login: null, suspended: true, admin_role: null })]);

    expect(csv.split('\r\n')).toEqual([
      'Name,Email,Last login,Status,Admin Role',
      'Ada Admin,ada@example.com,2026-08-01T10:00:00,Active,Admin',
      'Bo Blocked,bo@example.com,Never,Suspended,None',
    ]);
  });

  it('is the header alone when nothing matches the filter', () => {
    expect(buildAdminUsersCsv([])).toBe('Name,Email,Last login,Status,Admin Role');
  });
});
