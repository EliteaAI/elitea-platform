/**
 * Skill publishing — the behaviour, not the buttons.
 *
 * Every test here asserts the REQUEST a control produced or the ANSWER the
 * server's own reply produced, because the failure mode of a publish control is
 * one that looks live and publishes nothing (or publishes the wrong version),
 * and both render identically to a working one.
 */
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { PERMISSIONS } from '@/shared/lib/permissions';
import { server } from '@/test/setup';

import { PublishSkillModal } from '../ui/PublishSkillModal';
import { useSkillPublishing, type SkillPublishTarget } from '../model/useSkillPublishing';
import { renderHookWithProviders, renderWithProviders } from './testUtils';

const BASE = '/api/v2';
const PROJECT = '2';

interface Recorded {
  readonly url: string;
  readonly body: unknown;
}

let recorded: Recorded[] = [];

const draftTarget: SkillPublishTarget = {
  skillId: 7,
  versionId: 11,
  versionStatus: 'draft',
  versionNames: ['base', 'v1.0-taken'],
};

const publishPermissions = new Set([PERMISSIONS.skills.publish]);

function stubPlatform(settings: Record<string, unknown>): void {
  server.use(
    http.get(`${BASE}/elitea_core/platform_settings/prompt_lib`, () => HttpResponse.json(settings)),
  );
}

beforeEach(() => {
  recorded = [];
  configureGeneratedClient({ baseUrl: BASE });
  stubPlatform({ is_skill_publish_blocked: false });
  server.use(
    http.get(`${BASE}/elitea_core/skill_categories/prompt_lib/:projectId`, () =>
      HttpResponse.json({
        categories: [
          { name: 'Development', is_default: true },
          // An operator's own addition. It reaches the dialog only if the
          // client renders what the server sent rather than a hardcoded list.
          { name: 'Security', is_default: false },
          { name: 'Other', is_default: true },
        ],
        total: 3,
      }),
    ),
    http.post(
      `${BASE}/elitea_core/publish_skill_validate/prompt_lib/:projectId/:skillId/:versionId`,
      async ({ request }) => {
        recorded.push({ url: request.url, body: await request.json() });
        return HttpResponse.json({
          status: 'PASS',
          critical_issues: [],
          warnings: [],
          recommendations: [],
          summary: 'Ready to publish.',
          ai_validation_available: false,
          validation_token: 'token-1',
        });
      },
    ),
    http.post(
      `${BASE}/elitea_core/publish_skill/prompt_lib/:projectId/:skillId/:versionId`,
      async ({ request }) => {
        recorded.push({ url: request.url, body: await request.json() });
        return HttpResponse.json({ ok: true });
      },
    ),
    http.post(
      `${BASE}/elitea_core/unpublish_skill/prompt_lib/:projectId/:skillId/:versionId`,
      ({ request }) => {
        recorded.push({ url: request.url, body: null });
        return HttpResponse.json({ ok: true });
      },
    ),
  );
});

afterEach(() => {
  resetGeneratedClient();
});

describe('useSkillPublishing', () => {
  it('validates then publishes the version in view, forwarding the gate token', async () => {
    const { result } = renderHookWithProviders(() =>
      useSkillPublishing(PROJECT, draftTarget, publishPermissions),
    );

    act(() => result.current.open());
    act(() => result.current.setVersionName('v1.0-first'));
    act(() => result.current.setCategory('Security'));
    await act(async () => {
      await result.current.validate();
    });
    await act(async () => {
      await result.current.publish();
    });

    const validate = recorded.find((entry) => entry.url.includes('publish_skill_validate'));
    const publish = recorded.find(
      (entry) => entry.url.includes('/publish_skill/') && !entry.url.includes('validate'),
    );
    // The ids in the path are the skill and the VERSION the editor is showing —
    // publishing a different version would look identical on screen.
    expect(publish?.url).toContain(`/publish_skill/prompt_lib/${PROJECT}/7/11`);
    expect(validate?.body).toEqual({ version_name: 'v1.0-first', category: 'Security' });
    // The token the gate issued is sent back, which is what lets the server
    // skip re-validating content it already approved.
    expect(publish?.body).toEqual({
      version_name: 'v1.0-first',
      category: 'Security',
      validation_token: 'token-1',
    });
  });

  it('keeps a FAILED gate report instead of throwing it away with the 422', async () => {
    server.use(
      http.post(
        `${BASE}/elitea_core/publish_skill_validate/prompt_lib/:projectId/:skillId/:versionId`,
        () =>
          HttpResponse.json(
            {
              status: 'FAIL',
              critical_issues: [{ field: 'instructions', issue: 'Instructions are missing' }],
              warnings: [],
              recommendations: [],
              summary: 'Not ready.',
              ai_validation_available: false,
            },
            { status: 422 },
          ),
      ),
    );
    const { result } = renderHookWithProviders(() =>
      useSkillPublishing(PROJECT, draftTarget, publishPermissions),
    );

    act(() => result.current.open());
    act(() => result.current.setVersionName('v1.0-first'));
    await act(async () => {
      await result.current.validate();
    });

    expect(result.current.report?.status).toBe('FAIL');
    expect(result.current.report?.critical_issues[0]?.issue).toBe('Instructions are missing');
    // A FAIL carries no token, so a publish attempted anyway re-runs the gate
    // server-side rather than reusing a stale approval.
    expect(result.current.error).toBeUndefined();
  });

  it('surfaces the server sentence when a publish is refused', async () => {
    server.use(
      http.post(`${BASE}/elitea_core/publish_skill/prompt_lib/:projectId/:skillId/:versionId`, () =>
        HttpResponse.json(
          { error: 'publishing_blocked', msg: 'Skill publishing is blocked for this project by platform policy.' },
          { status: 403 },
        ),
      ),
    );
    const { result } = renderHookWithProviders(() =>
      useSkillPublishing(PROJECT, draftTarget, publishPermissions),
    );

    act(() => result.current.open());
    act(() => result.current.setVersionName('v1.0-first'));
    await act(async () => {
      await result.current.publish();
    });

    // The server's own sentence, not the transport's `eliteaFetch: 403 from …`.
    expect(result.current.error).toBe(
      'Skill publishing is blocked for this project by platform policy.',
    );
    expect(result.current.isOpen).toBe(true);
  });

  it('refuses a version name that already exists on this skill, before the request', () => {
    const { result } = renderHookWithProviders(() =>
      useSkillPublishing(PROJECT, draftTarget, publishPermissions),
    );

    act(() => result.current.setVersionName('v1.0-taken'));
    expect(result.current.versionNameError).toContain('already exists');

    act(() => result.current.setVersionName('spaces are not allowed'));
    expect(result.current.versionNameError).toContain('letters, digits');
  });

  it('hides the control without the publish permission, and for a published version', () => {
    const { result: noPermission } = renderHookWithProviders(() =>
      useSkillPublishing(PROJECT, draftTarget, new Set<string>()),
    );
    expect(noPermission.current.canShowPublish).toBe(false);

    const { result: published } = renderHookWithProviders(() =>
      useSkillPublishing(
        PROJECT,
        { ...draftTarget, versionStatus: 'published' },
        publishPermissions,
      ),
    );
    // A published version offers Unpublish instead — not a second Publish.
    expect(published.current.canShowPublish).toBe(false);
    expect(published.current.canUnpublish).toBe(true);
  });

  it('blocks publishing for a project outside the whitelist, but still shows the control', async () => {
    stubPlatform({
      is_skill_publish_blocked: true,
      skill_publish_whitelist_project_ids: [99],
    });
    const { result } = renderHookWithProviders(() =>
      useSkillPublishing(PROJECT, draftTarget, publishPermissions),
    );

    await waitFor(() => expect(result.current.blockedByPolicy).toBe(true));
    // Shown-but-disabled, not hidden: a control that vanishes when an operator
    // throws a platform switch reads as a broken page.
    expect(result.current.canShowPublish).toBe(true);
    expect(result.current.canPublish).toBe(false);
  });

  it('leaves publishing allowed for a whitelisted project', async () => {
    stubPlatform({
      is_skill_publish_blocked: true,
      skill_publish_whitelist_project_ids: [Number(PROJECT)],
    });
    const { result } = renderHookWithProviders(() =>
      useSkillPublishing(PROJECT, draftTarget, publishPermissions),
    );

    await waitFor(() => expect(result.current.categories.length).toBeGreaterThan(0));
    expect(result.current.blockedByPolicy).toBe(false);
    expect(result.current.canPublish).toBe(true);
  });

  it('unpublishes the version in view', async () => {
    const { result } = renderHookWithProviders(() =>
      useSkillPublishing(
        PROJECT,
        { ...draftTarget, versionStatus: 'published' },
        publishPermissions,
      ),
    );

    await act(async () => {
      await result.current.unpublish();
    });

    expect(recorded.some((entry) => entry.url.includes(`/unpublish_skill/prompt_lib/${PROJECT}/7/11`))).toBe(
      true,
    );
  });
});

describe('PublishSkillModal', () => {
  it('offers the categories the SERVER listed, including an operator addition', async () => {
    const user = userEvent.setup();
    function Harness() {
      const state = useSkillPublishing(PROJECT, draftTarget, publishPermissions);
      return (
        <>
          <button
            type="button"
            onClick={state.open}
          >
            open
          </button>
          <PublishSkillModal state={state} />
        </>
      );
    }
    renderWithProviders(<Harness />);
    await user.click(screen.getByRole('button', { name: 'open' }));

    await user.click(await screen.findByLabelText('Category'));
    expect(await screen.findByRole('option', { name: 'Security' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Development' })).toBeInTheDocument();
  });
});
