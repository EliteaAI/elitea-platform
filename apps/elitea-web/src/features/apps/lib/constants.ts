import { WikiQueryIcon } from '@/shared/ui/icons/wiki-query-icon';
import { InventorySearchIcon } from '@/shared/ui/icons/inventory-search-icon';
import type { SvgIconComponent } from '@/shared/ui/icons/svg-icon.types';

/**
 * Ported from
 * `apps/elitea-ui/src/[fsd]/features/apps/lib/constants/applicationCatalog.constants.js`.
 *
 * The old app's "App Catalog" tab (`AppsTabs[1]`, `/apps/catalog`) is a
 * STATIC, hard-coded 2-item list — there is no server-side entity behind it
 * (confirmed against `entities/app`'s module doc: the marketplace `App`
 * type is a DIFFERENT concept, `PublicApplicationSummary`). This catalogue
 * therefore has no `entities/` type of its own; it is local, feature-owned
 * data, exactly as it was in the baseline.
 */

/** One entry in the static App Catalog. */
export interface ApplicationCatalogEntry {
  /** The toolkit "type" key this catalogue entry configures (`ToolkitTypeSchemaMap` key). */
  readonly type: string;
  readonly name: string;
  readonly Icon: SvgIconComponent;
  readonly shortDescription: string;
  readonly description: string;
  readonly capabilities: readonly string[];
  readonly bestFor: string;
  readonly documentation: string;
}

export const APPLICATION_REQUEST_SUPPORT_EMAIL = 'SupportAlita@epam.com';

export const REQUEST_STATUS = {
  NONE: 'none',
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
} as const;

export type RequestStatus = (typeof REQUEST_STATUS)[keyof typeof REQUEST_STATUS];

export const APPLICATION_CATALOG: readonly ApplicationCatalogEntry[] = [
  {
    type: 'wikis_Wikis',
    name: 'Wikis',
    Icon: WikiQueryIcon,
    shortDescription: 'Generate searchable wiki pages from repository code.',
    description:
      'DeepWiki turns a code repository into navigable documentation with architecture summaries, source-linked explanations, and project Q&A support.',
    capabilities: ['Wiki generation', 'Architecture summaries', 'Code-aware Q&A'],
    bestFor: 'Onboarding, implementation context, and team knowledge',
    documentation: 'https://docs.elitea.ai/integrations/apps/wikis',
  },
  {
    type: 'inventory',
    name: 'Inventory',
    Icon: InventorySearchIcon,
    shortDescription: 'Explore services, ownership, dependencies, and repository landscape.',
    description:
      'Inventory helps teams inspect the code estate, map important components, and understand relationships before planning changes.',
    capabilities: ['Component inventory', 'Dependency discovery', 'Ownership context'],
    bestFor: 'Modernization, impact analysis, and engineering governance',
    documentation: 'https://docs.elitea.ai/integrations/apps/inventory',
  },
] as const;
