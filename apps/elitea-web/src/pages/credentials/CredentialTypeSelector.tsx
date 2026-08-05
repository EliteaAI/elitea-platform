/**
 * pages/credentials/CredentialTypeSelector.tsx — the "choose a credential
 * type to create" grid, shown by `CredentialForm` before a type is picked.
 * Ported from `apps/elitea-ui/src/pages/Credentials/CredentialTypeSelector.jsx`.
 *
 * DISCLOSED SIMPLIFICATION: the baseline resolves a per-type icon via
 * `getToolIconByType` (`common/toolkitUtils`, the toolkits domain's icon
 * resolver — out of this unit's ownership fence) and groups items by
 * `config_schema.properties.data.metadata.categories[0]`. This port drops
 * the per-type icon (every tile renders with no leading icon — a real,
 * disclosed visual regression, not a functional one) and groups by the
 * same category field, defaulting to "Other" exactly as the baseline does.
 * Search is a local `useState`, not the baseline's `useGroupedCategories`
 * (`shared/lib/hooks`, unconfirmed to exist within this unit's ownership).
 */
import { useMemo, useState, type ReactNode } from 'react';

import { t } from '@/shared/i18n';
import { CategorySection } from '@/shared/ui/CategorySection';
import { GroupedCategory } from '@/shared/ui/GroupedCategory';
import { NoResultsMessage } from '@/shared/ui/NoResultsMessage';
import { SimpleSearchBar } from '@/shared/ui/SimpleSearchBar';
import type { CategoryItem } from '@/shared/ui/CategoryItemCard';

import type { ConfigurationTypeDescriptor } from '@/features/credentials';

export interface CredentialTypeSelectorProps {
  readonly configurationsData: readonly ConfigurationTypeDescriptor[] | undefined;
  readonly isFetching: boolean;
  readonly onSelectType: (type: string) => void;
}

function displayLabel(item: ConfigurationTypeDescriptor): string {
  return item.config_schema.metadata?.label ?? item.config_schema.title ?? item.type;
}

function category(item: ConfigurationTypeDescriptor): string {
  return item.config_schema.properties?.['data']?.metadata?.categories?.[0] ?? 'Other';
}

export function CredentialTypeSelector({ configurationsData, isFetching, onSelectType }: CredentialTypeSelectorProps): ReactNode {
  const [query, setQuery] = useState('');

  const visibleItems = useMemo(() => {
    const items = (configurationsData ?? []).filter((item) => item.config_schema.metadata?.hidden !== true);
    const needle = query.trim().toLowerCase();
    const filtered = needle === '' ? items : items.filter((item) => displayLabel(item).toLowerCase().includes(needle));
    return [...filtered].sort((a, b) => displayLabel(a).toLowerCase().localeCompare(displayLabel(b).toLowerCase()));
  }, [configurationsData, query]);

  const allCategories = useMemo(() => [...new Set(visibleItems.map(category))].sort((a, b) => a.localeCompare(b)), [visibleItems]);

  const groupedItems = useMemo(() => {
    const groups: Record<string, CategoryItem[]> = {};
    for (const item of visibleItems) {
      const key = category(item);
      const entry: CategoryItem = { key: item.type, label: displayLabel(item), onClick: () => { onSelectType(item.type); } };
      (groups[key] ??= []).push(entry);
    }
    return groups;
  }, [visibleItems, onSelectType]);

  return (
    <div>
      <SimpleSearchBar
        value={query}
        onChange={setQuery}
        placeholder={t('credentials.typeSelector.search', 'Search credentials')}
      />
      <GroupedCategory
        isLoading={isFetching}
        allCategories={allCategories}
        groupedItems={groupedItems}
        renderCategory={(cat, items) => (
          <CategorySection
            key={cat}
            category={cat}
            items={items}
          />
        )}
        noResultsSlot={
          <NoResultsMessage
            title={t('credentials.typeSelector.noResultsTitle', 'No credentials found')}
            description={t('credentials.typeSelector.noResultsDescription', 'Try adjusting your search terms or category filters')}
          />
        }
      />
    </div>
  );
}
