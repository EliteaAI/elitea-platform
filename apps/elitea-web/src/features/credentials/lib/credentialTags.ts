/**
 * lib/credentialTags.ts — category/tag list derivation for the credentials
 * list screen (unit A7). Ported from
 * `apps/elitea-ui/src/[fsd]/features/credentials/lib/helpers/credential.helpers.js`
 * `generateCredentialTagList`.
 */
import { providerDisplayName } from '@/entities/credential';
import type { Credential } from '@/entities/credential';

export interface CredentialTag {
  readonly id: string;
  readonly name: string;
  readonly data: { readonly type: string };
  readonly credentialCount: number;
}

/**
 * Groups credentials by `type`, one tag per distinct type, alphabetically
 * sorted by display name — exact port of `generateCredentialTagList`
 * (`credential.helpers.js:4-30`), including its `type + (index + 1)` id
 * scheme (the index is the position in `Object.keys(typeCounts)`, taken
 * BEFORE the alphabetical sort, so it is not itself meaningfully ordered —
 * preserved verbatim rather than "fixed" since nothing reads the id as
 * anything but an opaque React key today).
 */
export function generateCredentialTagList(credentials: readonly Credential[]): CredentialTag[] {
  const typeCounts = new Map<string, number>();
  for (const credential of credentials) {
    typeCounts.set(credential.type, (typeCounts.get(credential.type) ?? 0) + 1);
  }

  const tags: CredentialTag[] = [...typeCounts.keys()].map((type, index) => ({
    id: `${type}${index + 1}`,
    name: providerDisplayName(type),
    data: { type },
    credentialCount: typeCounts.get(type) ?? 0,
  }));

  return tags.sort((a, b) => a.name.localeCompare(b.name));
}
