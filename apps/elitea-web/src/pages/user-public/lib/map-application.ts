import { authorDisplayName } from '@/entities/author';
import type { Application } from '@/shared/api/generated/model';

import type { UserPublicListItem } from './types';

/**
 * `agent_type === 'pipeline'` distinguishes a Pipeline from a plain
 * Application — same discriminant `entities/application`'s
 * `isPipelineApplication` uses (`src/entities/application/model/selectors.ts:27-29`),
 * reapplied to the wire (snake_case) shape directly since that entity
 * function takes the camelCase entity type this page does not construct
 * (see `./types.ts`'s header comment).
 */
export function isPipelineApplication(application: Application): boolean {
  return application.agent_type === 'pipeline';
}

export function mapApplicationToListItem(application: Application): UserPublicListItem {
  return {
    id: application.id,
    name: application.name.trim() !== '' ? application.name : 'Untitled',
    description: application.description ?? '',
    status: application.status,
    authorNames: (application.authors ?? []).map((author) => authorDisplayName(author)),
    createdAt: application.created_at,
  };
}
