import { describe, expect, it } from 'vitest';

import {
  normaliseApp,
  normaliseAppDetail,
  normaliseAppPage,
  normaliseApps,
  normaliseAppVersionDetail,
} from './normalise';
import type { AppDetailWire, AppPageWire, AppVersionDetailWire, AppWire } from '../model/types';

const wire: AppWire = {
  project_id: 'proj-1',
  id: 'app-1',
  name: 'Support Bot',
  description: 'Answers support tickets.',
  version_id: 'ver-1',
  version_name: 'v1',
  agent_type: 'chat',
  meta: { category: 'support' },
};

describe('normaliseApp', () => {
  it('maps snake_case wire fields to camelCase', () => {
    expect(normaliseApp(wire)).toEqual({
      projectId: 'proj-1',
      id: 'app-1',
      name: 'Support Bot',
      description: 'Answers support tickets.',
      versionId: 'ver-1',
      versionName: 'v1',
      agentType: 'chat',
      meta: { category: 'support' },
    });
  });

  it('preserves a null meta rather than defaulting it to {}', () => {
    expect(normaliseApp({ ...wire, meta: null }).meta).toBeNull();
  });

  it('never invents the client-only likes/isLiked fields', () => {
    const result = normaliseApp(wire);
    expect('likes' in result).toBe(false);
    expect('isLiked' in result).toBe(false);
  });
});

describe('normaliseApps', () => {
  it('maps every entry in order', () => {
    const second: AppWire = { ...wire, id: 'app-2', name: 'Sales Bot' };
    expect(normaliseApps([wire, second]).map((app) => app.id)).toEqual(['app-1', 'app-2']);
  });

  it('returns an empty array for an empty input', () => {
    expect(normaliseApps([])).toEqual([]);
  });
});

describe('normaliseAppPage', () => {
  it('unwraps the rows+total envelope', () => {
    const page: AppPageWire = { rows: [wire], total: 1 };
    expect(normaliseAppPage(page)).toEqual({
      rows: [normaliseApp(wire)],
      total: 1,
    });
  });

  it('preserves total 0 with an empty rows array', () => {
    const page: AppPageWire = { rows: [], total: 0 };
    expect(normaliseAppPage(page)).toEqual({ rows: [], total: 0 });
  });
});

const versionDetailWire: AppVersionDetailWire = {
  id: 'ver-1',
  application_id: 'app-1',
  name: 'v1',
  status: 'published',
  created_at: '2026-01-01T00:00:00Z',
  agent_type: 'chat',
  instructions: 'Be helpful.',
  welcome_message: 'Hi there!',
  llm_settings: { model_name: 'gpt' },
  meta: { category: 'support' },
  conversation_starters: ['Hello'],
  pipeline_settings: { step: 1 },
  author_id: 'user-1',
  author: { id: 'user-1', email: 'a@example.com', name: 'Alex' },
  tools: [{ id: 1 }],
  tags: [{ name: 'support' }],
  variables: [{ name: 'API_KEY', value: null }],
  is_forked: true,
};

describe('normaliseAppVersionDetail', () => {
  it('maps every present snake_case field to camelCase', () => {
    expect(normaliseAppVersionDetail(versionDetailWire)).toEqual({
      id: 'ver-1',
      applicationId: 'app-1',
      name: 'v1',
      status: 'published',
      createdAt: '2026-01-01T00:00:00Z',
      agentType: 'chat',
      instructions: 'Be helpful.',
      welcomeMessage: 'Hi there!',
      llmSettings: { model_name: 'gpt' },
      meta: { category: 'support' },
      conversationStarters: ['Hello'],
      pipelineSettings: { step: 1 },
      authorId: 'user-1',
      author: { id: 'user-1', email: 'a@example.com', name: 'Alex' },
      tools: [{ id: 1 }],
      tags: [{ name: 'support' }],
      variables: [{ name: 'API_KEY', value: null }],
      isForked: true,
    });
  });

  it('preserves a false is_forked rather than dropping or defaulting it', () => {
    expect(normaliseAppVersionDetail({ ...versionDetailWire, is_forked: false }).isForked).toBe(false);
  });

  it('preserves a null meta rather than defaulting it to {}', () => {
    expect(normaliseAppVersionDetail({ ...versionDetailWire, meta: null }).meta).toBeNull();
  });

  it('leaves optional keys entirely ABSENT — not undefined-valued — when the wire omits them, matching publicApplicationDetail (NOTE(W2): eliteacore/handler.go:1460-1475, which never sends variables/created_at/author/is_forked)', () => {
    const minimal: AppVersionDetailWire = {
      id: 'ver-1',
      application_id: 'app-1',
      name: 'v1',
      status: 'published',
    };
    const result = normaliseAppVersionDetail(minimal);
    expect(result).toEqual({
      id: 'ver-1',
      applicationId: 'app-1',
      name: 'v1',
      status: 'published',
    });
    expect('variables' in result).toBe(false);
    expect('createdAt' in result).toBe(false);
    expect('author' in result).toBe(false);
    expect('isForked' in result).toBe(false);
  });
});

describe('normaliseAppDetail', () => {
  it('maps id/name/description and nests the normalised version details', () => {
    const detailWire: AppDetailWire = {
      id: 'app-1',
      name: 'Support Bot',
      description: 'Answers support tickets.',
      version_details: versionDetailWire,
    };
    expect(normaliseAppDetail(detailWire)).toEqual({
      id: 'app-1',
      name: 'Support Bot',
      description: 'Answers support tickets.',
      versionDetails: normaliseAppVersionDetail(versionDetailWire),
    });
  });
});
