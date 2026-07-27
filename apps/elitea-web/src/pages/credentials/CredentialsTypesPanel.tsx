/**
 * pages/credentials/CredentialsTypesPanel.tsx — the right-rail type/category
 * filter on the credentials list. Ported from
 * `apps/elitea-ui/src/pages/Credentials/CredentialsTypesPanel.jsx`.
 *
 * DISCLOSED SIMPLIFICATION: the baseline's `useCredentialTypes` hook
 * (`hooks/credentials/useCredentialTypes.js`) synchronizes the selected
 * types with a `tags` URL search param via `react-router-dom`. That param
 * is not part of PARAM-037..046 (the credentials domain's validated
 * search-param set owned by unit R1 — `forceCustom`/`from`/`prefill_id`/
 * `prefill_name`/`section` only), so this port keeps the selection as
 * local component state (owned by the caller, `CredentialsList.tsx`)
 * instead of registering a new, unvalidated search param on a route file
 * this unit does not own.
 *
 * `CredentialTag`'s shape is inlined rather than imported from
 * `@/features/credentials` — that slice's public-API budget (§3.5, ≤20) is
 * already at its limit (see that file's own doc comment); this is a
 * read-only structural subset of `generateCredentialTagList`'s real return
 * type, not a duplicate domain definition.
 */
import type { ReactNode } from 'react';

import { CategoryFilter } from '@/shared/ui/CategoryFilter';

export interface CredentialTypeTag {
  readonly id: string;
  readonly name: string;
  readonly data: { readonly type: string };
  readonly credentialCount: number;
}

export interface CredentialsTypesPanelProps {
  readonly tagList: readonly CredentialTypeTag[];
  readonly selectedTypes: readonly string[];
  readonly onToggleType: (type: string) => void;
}

export function CredentialsTypesPanel({ tagList, selectedTypes, onToggleType }: CredentialsTypesPanelProps): ReactNode {
  const nameByType = new Map(tagList.map((tag) => [tag.name, tag.data.type]));
  const selectedNames = tagList.filter((tag) => selectedTypes.includes(tag.data.type)).map((tag) => tag.name);

  return (
    <CategoryFilter
      allCategories={tagList.map((tag) => tag.name)}
      selectedCategories={selectedNames}
      onSelectCategory={(name) => {
        const type = nameByType.get(name);
        if (type !== undefined) onToggleType(type);
      }}
    >
      {tagList.map((tag) => (
        <div key={tag.id}>
          {tag.name} ({tag.credentialCount})
        </div>
      ))}
    </CategoryFilter>
  );
}
