/**
 * The signed-in user, in the shape `ChatBox` wants it.
 *
 * The same author read `ui/ChatWithPipelineButton.tsx` already performs, and
 * for the same reason: the USER participant is the client's to add, and the
 * resolver's author join is an INNER JOIN on it. One hook so the editor page
 * and its test-chat pane read it once, through TanStack's cache, rather than
 * twice.
 */
import { useMemo } from 'react';

import type { SocialAuthorProfile } from '@/shared/api/generated/model';
import { useGetCurrentAuthor } from '@/shared/api/generated/social/social';
import { unwrapBody } from '@/shared/api/unwrap';

export interface PipelineEditorUser {
  readonly id?: string;
  readonly name?: string;
  readonly avatar?: string;
}

/**
 * The transport peel comes from `shared/api/unwrap.ts` — the ONE place
 * envelope knowledge lives (R-A6, `elitea/no-adhoc-envelope-unwrap`).
 * `unwrapBody` makes no claim about the body, so the cast is this caller's.
 */
function currentAuthorOf(data: unknown): SocialAuthorProfile | undefined {
  return unwrapBody(data) as SocialAuthorProfile | undefined;
}

export function usePipelineEditorUser(): PipelineEditorUser | undefined {
  const authorQuery = useGetCurrentAuthor();
  const author = currentAuthorOf(authorQuery.data);
  const id = author?.id;
  const name = author?.name;
  const avatar = author?.avatar;

  return useMemo<PipelineEditorUser | undefined>(() => {
    if (id === undefined) return undefined;
    return {
      id: String(id),
      ...(name !== undefined ? { name } : {}),
      ...(avatar !== undefined ? { avatar } : {}),
    };
  }, [id, name, avatar]);
}
