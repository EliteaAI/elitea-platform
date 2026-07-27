import type { Application } from './types';

/**
 * NOTE(W2), v2.yaml:479-486: `updated_at` is ALWAYS present on the wire but
 * the List path never scans the column, so every row from a list endpoint
 * carries this zero sentinel rather than a real timestamp. A recency sort
 * that used `updatedAt` blindly would put every list row at the same
 * (oldest-looking) instant; falling back to `createdAt` for sentinel rows is
 * required for the sort to mean anything on that endpoint.
 */
const ZERO_SENTINEL_TIMESTAMP = '0001-01-01T00:00:00Z';

function effectiveRecencyTimestamp(application: Application): string {
  return application.updatedAt === ZERO_SENTINEL_TIMESTAMP ? application.createdAt : application.updatedAt;
}

/** Most-recently-updated first, falling back to `createdAt` for the List-endpoint sentinel (see above). */
export function sortApplicationsByRecency(applications: readonly Application[]): Application[] {
  return [...applications].sort((a, b) => effectiveRecencyTimestamp(b).localeCompare(effectiveRecencyTimestamp(a)));
}

export function isForkedApplication(application: Application): boolean {
  return application.isForked;
}

/** `agent_type === 'pipeline'` is what distinguishes a Pipeline from a plain Application. */
export function isPipelineApplication(application: Application): boolean {
  return application.agentType === 'pipeline';
}

export function isOwnedApplication(application: Application, userId: string): boolean {
  return application.ownerId === userId;
}

/** Display name with an "Untitled" fallback for a blank/whitespace-only name. */
export function applicationDisplayName(application: Application): string {
  return application.name.trim() !== '' ? application.name : 'Untitled';
}
