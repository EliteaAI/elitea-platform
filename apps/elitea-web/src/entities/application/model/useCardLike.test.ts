import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { getUnlikeApplicationMockHandler } from '@/shared/api/generated/social/social.msw';
import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';

import { server } from '../../../test/setup';

import { useCardLike } from './useCardLike';

/**
 * Regression coverage for adversarial-review fix, cluster A13-agents-hub,
 * finding 1: `toggleLike` previously never called the server at all. These
 * tests assert the real `/social/like` request fires and that a failed
 * request reverts the optimistic UI instead of silently claiming success.
 */
describe('useCardLike', () => {
  afterEach(() => {
    resetGeneratedClient();
  });

  it('POSTs /social/like/prompt_lib/{projectId}/application/{applicationId} and flips liked+count on success', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    let requestedUrl: string | undefined;
    server.use(
      http.post('*/social/like/prompt_lib/:projectId/application/:applicationId', ({ request }) => {
        requestedUrl = request.url;
        return HttpResponse.json({ ok: true }, { status: 200 });
      }),
    );

    const { result } = renderHook(() =>
      useCardLike({ applicationId: '42', projectId: 'pub-1', initialLiked: false, initialCount: 3 }),
    );

    expect(result.current.isLiked).toBe(false);
    expect(result.current.likeCount).toBe(3);

    await act(async () => {
      await result.current.toggleLike();
    });

    expect(result.current.isLiked).toBe(true);
    expect(result.current.likeCount).toBe(4);
    expect(requestedUrl).toContain('/social/like/prompt_lib/pub-1/application/42');
  });

  it('DELETEs the like endpoint and decrements the count when already liked', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    let method: string | undefined;
    server.use(
      http.delete('*/social/like/prompt_lib/:projectId/application/:applicationId', ({ request }) => {
        method = request.method;
        return HttpResponse.json({ ok: true }, { status: 200 });
      }),
    );

    const { result } = renderHook(() =>
      useCardLike({ applicationId: '43', projectId: 'pub-1', initialLiked: true, initialCount: 5 }),
    );

    await act(async () => {
      await result.current.toggleLike();
    });

    expect(result.current.isLiked).toBe(false);
    expect(result.current.likeCount).toBe(4);
    expect(method).toBe('DELETE');
  });

  it('reverts the optimistic update when the server call fails (known backend defect — see module doc comment)', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    // Deliberately NOT `getLikeApplicationMockHandler` here: that generated
    // helper always wraps its response at `{ status: 200 }` regardless of
    // what an override callback returns, so it cannot produce a real 500. A
    // raw handler is needed to exercise the failure path.
    server.use(
      http.post('*/social/like/prompt_lib/:projectId/application/:applicationId', () =>
        HttpResponse.json({ ok: false, error: 'boom' }, { status: 500 }),
      ),
    );

    const { result } = renderHook(() =>
      useCardLike({ applicationId: '44', projectId: 'pub-1', initialLiked: false, initialCount: 0 }),
    );

    await act(async () => {
      await result.current.toggleLike();
    });

    await waitFor(() => {
      expect(result.current.isLiked).toBe(false);
      expect(result.current.likeCount).toBe(0);
    });
  });

  it('calls onLikeSuccess with the new state once the server confirms the like', async () => {
    configureGeneratedClient({ baseUrl: '/api/v2' });
    server.use(getUnlikeApplicationMockHandler());
    const calls: Array<[string, boolean, number]> = [];

    const { result } = renderHook(() =>
      useCardLike({
        applicationId: '45',
        projectId: 'pub-1',
        initialLiked: true,
        initialCount: 1,
        onLikeSuccess: (id, liked, count) => calls.push([id, liked, count]),
      }),
    );

    await act(async () => {
      await result.current.toggleLike();
    });

    expect(calls).toEqual([['45', false, 0]]);
  });
});
