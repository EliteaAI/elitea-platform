import { describe, expect, it } from 'vitest';

import {
  normaliseApplication,
  normaliseApplicationCreatedResponse,
  normaliseApplicationDetail,
  normaliseApplicationPage,
  normaliseApplicationUpdatedResponse,
  normaliseApplicationVersionDetail,
  normaliseApplicationVersionSummary,
  normaliseApplications,
} from './normalise';
import type {
  ApplicationCreatedResponseWire,
  ApplicationDetailWire,
  ApplicationListWire,
  ApplicationUpdatedResponseWire,
  ApplicationVersionDetailWire,
  ApplicationVersionSummaryWire,
  ApplicationWire,
} from './normalise';

const wire: ApplicationWire = {
  id: 'app-1',
  project_id: 'proj-1',
  name: 'Support Agent',
  description: 'Handles support tickets',
  type: 'chat',
  icon: 'icon.svg',
  tags: ['support', 'chat'],
  folder_id: 'folder-1',
  status: 'active',
  metadata: { source: 'import' },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  created_by: 'user-1',
  owner_id: 'owner-1',
  authors: [{ id: 'a1', email: 'a1@example.com', name: 'Author One' }],
  is_forked: true,
  meta: { foo: 'bar' },
  has_interrupt: true,
  agent_type: 'openai',
};

describe('normaliseApplication', () => {
  it('maps every snake_case field to its camelCase counterpart', () => {
    expect(normaliseApplication(wire)).toEqual({
      id: 'app-1',
      projectId: 'proj-1',
      name: 'Support Agent',
      description: 'Handles support tickets',
      type: 'chat',
      icon: 'icon.svg',
      tags: ['support', 'chat'],
      folderId: 'folder-1',
      status: 'active',
      metadata: { source: 'import' },
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      createdBy: 'user-1',
      ownerId: 'owner-1',
      authors: [{ id: 'a1', email: 'a1@example.com', name: 'Author One' }],
      isForked: true,
      meta: { foo: 'bar' },
      hasInterrupt: true,
      agentType: 'openai',
    });
  });

  it('preserves false is_forked/has_interrupt rather than defaulting them', () => {
    const result = normaliseApplication({ ...wire, is_forked: false, has_interrupt: false });
    expect(result.isForked).toBe(false);
    expect(result.hasInterrupt).toBe(false);
  });

  it('preserves a null meta rather than defaulting or dropping it', () => {
    expect(normaliseApplication({ ...wire, meta: null }).meta).toBeNull();
  });

  it('omits optional keys entirely when absent from the wire, rather than setting them to undefined', () => {
    const minimal: ApplicationWire = {
      id: 'app-2',
      name: 'Minimal Agent',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      owner_id: 'owner-2',
      is_forked: false,
      meta: null,
      has_interrupt: false,
    };
    const result = normaliseApplication(minimal);
    expect(result).toEqual({
      id: 'app-2',
      name: 'Minimal Agent',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      ownerId: 'owner-2',
      isForked: false,
      meta: null,
      hasInterrupt: false,
    });
    expect(Object.keys(result)).not.toContain('projectId');
    expect(Object.keys(result)).not.toContain('authors');
  });
});

describe('normaliseApplications', () => {
  it('maps every entry in order', () => {
    const second: ApplicationWire = { ...wire, id: 'app-2', name: 'Second Agent' };
    expect(normaliseApplications([wire, second]).map((a) => a.id)).toEqual(['app-1', 'app-2']);
  });

  it('returns an empty array for an empty input', () => {
    expect(normaliseApplications([])).toEqual([]);
  });
});

describe('normaliseApplicationPage', () => {
  it('maps the list envelope, including page_size/total_pages renaming', () => {
    const listWire: ApplicationListWire = {
      rows: [wire],
      total: 1,
      page: 1,
      page_size: 20,
      total_pages: 1,
    };
    expect(normaliseApplicationPage(listWire)).toEqual({
      rows: [normaliseApplication(wire)],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    });
  });

  it('returns an empty rows array for an empty page', () => {
    const emptyWire: ApplicationListWire = { rows: [], total: 0, page: 1, page_size: 20, total_pages: 0 };
    expect(normaliseApplicationPage(emptyWire).rows).toEqual([]);
  });
});

describe('normaliseApplicationVersionSummary', () => {
  it('maps agent_type/created_at to camelCase', () => {
    const summaryWire: ApplicationVersionSummaryWire = {
      id: 'v1',
      name: 'v1.0',
      status: 'active',
      agent_type: 'pipeline',
      created_at: '2026-01-01T00:00:00Z',
    };
    expect(normaliseApplicationVersionSummary(summaryWire)).toEqual({
      id: 'v1',
      name: 'v1.0',
      status: 'active',
      agentType: 'pipeline',
      createdAt: '2026-01-01T00:00:00Z',
    });
  });
});

describe('normaliseApplicationVersionDetail', () => {
  const minimalVersionWire: ApplicationVersionDetailWire = {
    id: 'v1',
    application_id: 'app-1',
    name: 'v1.0',
    status: 'active',
  };

  it('maps only the required fields when every optional key is absent (UpdateVersion-shaped)', () => {
    const result = normaliseApplicationVersionDetail(minimalVersionWire);
    expect(result).toEqual({ id: 'v1', applicationId: 'app-1', name: 'v1.0', status: 'active' });
    expect(Object.keys(result)).not.toContain('authorId');
    expect(Object.keys(result)).not.toContain('author');
  });

  it('maps author_id without inventing an author (fetchVersionDetails shape)', () => {
    const result = normaliseApplicationVersionDetail({ ...minimalVersionWire, author_id: 'user-1' });
    expect(result.authorId).toBe('user-1');
    expect(result).not.toHaveProperty('author');
  });

  it('maps author without inventing an author_id (CreateVersion shape)', () => {
    const result = normaliseApplicationVersionDetail({
      ...minimalVersionWire,
      author: { id: 'user-1', email: 'user1@example.com', name: 'User One' },
      is_forked: true,
    });
    expect(result.author).toEqual({ id: 'user-1', email: 'user1@example.com', name: 'User One' });
    expect(result).not.toHaveProperty('authorId');
    expect(result.isForked).toBe(true);
  });

  it('preserves false is_forked rather than defaulting it', () => {
    expect(normaliseApplicationVersionDetail({ ...minimalVersionWire, is_forked: false }).isForked).toBe(false);
  });

  it('preserves a null meta rather than dropping the key', () => {
    expect(normaliseApplicationVersionDetail({ ...minimalVersionWire, meta: null }).meta).toBeNull();
  });

  it('carries opaque tags/tools/variables passthrough arrays verbatim', () => {
    const result = normaliseApplicationVersionDetail({
      ...minimalVersionWire,
      tags: [{ name: null, data: undefined }],
      tools: [{ id: 1 }],
      variables: [{ name: 'X', value: null }, { value: 'no-name' }],
    });
    expect(result.tags).toEqual([{ name: null, data: undefined }]);
    expect(result.tools).toEqual([{ id: 1 }]);
    expect(result.variables).toEqual([{ name: 'X', value: null }, { value: 'no-name' }]);
  });
});

describe('normaliseApplicationDetail', () => {
  it('maps owner_id/created_at and nested versions/version_details', () => {
    const detailWire: ApplicationDetailWire = {
      id: 'app-1',
      name: 'Support Agent',
      description: 'Handles tickets',
      icon: 'icon.svg',
      owner_id: 'owner-1',
      created_at: '2026-01-01T00:00:00Z',
      versions: [{ id: 'v1', name: 'v1.0', status: 'active', agent_type: 'openai', created_at: '2026-01-01T00:00:00Z' }],
      version_details: { id: 'v1', application_id: 'app-1', name: 'v1.0', status: 'active' },
    };
    expect(normaliseApplicationDetail(detailWire)).toEqual({
      id: 'app-1',
      name: 'Support Agent',
      description: 'Handles tickets',
      icon: 'icon.svg',
      ownerId: 'owner-1',
      createdAt: '2026-01-01T00:00:00Z',
      versions: [{ id: 'v1', name: 'v1.0', status: 'active', agentType: 'openai', createdAt: '2026-01-01T00:00:00Z' }],
      versionDetails: { id: 'v1', applicationId: 'app-1', name: 'v1.0', status: 'active' },
    });
  });

  it('omits versionDetails when version_details is absent (no version detail row loaded)', () => {
    const detailWire: ApplicationDetailWire = {
      id: 'app-1',
      name: 'Support Agent',
      description: 'Handles tickets',
      icon: 'icon.svg',
      owner_id: 'owner-1',
      created_at: '2026-01-01T00:00:00Z',
      versions: [],
    };
    const result = normaliseApplicationDetail(detailWire);
    expect(result.versions).toEqual([]);
    expect(result).not.toHaveProperty('versionDetails');
  });
});

describe('normaliseApplicationCreatedResponse', () => {
  const createdWire: ApplicationCreatedResponseWire = {
    id: 'app-1',
    name: 'Support Agent',
    description: 'Handles tickets',
    type: 'chat',
    icon: 'icon.svg',
    owner_id: 'owner-1',
    created_at: '2026-01-01T00:00:00Z',
  };

  it('maps the required fields when the request carried no versions array', () => {
    const result = normaliseApplicationCreatedResponse(createdWire);
    expect(result).toEqual({
      id: 'app-1',
      name: 'Support Agent',
      description: 'Handles tickets',
      type: 'chat',
      icon: 'icon.svg',
      ownerId: 'owner-1',
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(result).not.toHaveProperty('versionDetails');
    expect(result).not.toHaveProperty('versions');
  });

  it('maps versions as a single-element echo of version_details when the request carried versions', () => {
    const versionDetailWire: ApplicationVersionDetailWire = {
      id: 'v1',
      application_id: 'app-1',
      name: 'v1.0',
      status: 'active',
      author: { id: 'user-1', email: 'user1@example.com', name: 'User One' },
      is_forked: true,
    };
    const result = normaliseApplicationCreatedResponse({
      ...createdWire,
      version_details: versionDetailWire,
      versions: [versionDetailWire],
    });
    expect(result.versionDetails).toEqual(normaliseApplicationVersionDetail(versionDetailWire));
    expect(result.versions).toEqual([normaliseApplicationVersionDetail(versionDetailWire)]);
  });
});

describe('normaliseApplicationUpdatedResponse', () => {
  it('maps owner_id/created_at and optional version_details', () => {
    const updatedWire: ApplicationUpdatedResponseWire = {
      id: 'app-1',
      name: 'Support Agent',
      description: 'Handles tickets',
      icon: 'icon.svg',
      owner_id: 'owner-1',
      created_at: '2026-01-01T00:00:00Z',
      version_details: { id: 'v1', application_id: 'app-1', name: 'v1.0', status: 'active' },
    };
    expect(normaliseApplicationUpdatedResponse(updatedWire)).toEqual({
      id: 'app-1',
      name: 'Support Agent',
      description: 'Handles tickets',
      icon: 'icon.svg',
      ownerId: 'owner-1',
      createdAt: '2026-01-01T00:00:00Z',
      versionDetails: { id: 'v1', applicationId: 'app-1', name: 'v1.0', status: 'active' },
    });
  });

  it('omits versionDetails entirely when version_details is absent', () => {
    const result = normaliseApplicationUpdatedResponse({
      id: 'app-1',
      name: 'Support Agent',
      description: 'Handles tickets',
      icon: 'icon.svg',
      owner_id: 'owner-1',
      created_at: '2026-01-01T00:00:00Z',
    });
    expect(result).not.toHaveProperty('versionDetails');
  });
});
