import { afterEach, describe, expect, it } from 'vitest';

import { resetConfigForTests } from '@/shared/config/get-config';

import { isPublicAgentsProject } from './isPublicAgentsProject';

const globals = globalThis as unknown as Record<string, unknown>;

function setConfig(publicProjectId: string): void {
  globals['elitea_ui_config'] = {
    vite_server_url: 'https://elitea.example',
    vite_base_uri: '/',
    vite_public_project_id: publicProjectId,
  };
  resetConfigForTests();
}

afterEach(() => {
  delete globals['elitea_ui_config'];
  resetConfigForTests();
});

describe('isPublicAgentsProject', () => {
  it('returns false when projectId is undefined', () => {
    setConfig('1');
    expect(isPublicAgentsProject(undefined)).toBe(false);
  });

  it('returns false when config has not resolved (no source defines it)', () => {
    expect(isPublicAgentsProject('1')).toBe(false);
  });

  it('returns true when the projectId string-matches the configured public project id', () => {
    setConfig('42');
    expect(isPublicAgentsProject('42')).toBe(true);
  });

  it('returns false for a private (non-matching) projectId', () => {
    setConfig('42');
    expect(isPublicAgentsProject('7')).toBe(false);
  });
});
