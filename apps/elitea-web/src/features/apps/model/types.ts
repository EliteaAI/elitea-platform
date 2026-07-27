import type { SvgIconComponent } from '@/shared/ui/icons/svg-icon.types';

/**
 * Discriminant for a catalog entry's availability, replacing the baseline's
 * `getApplicationStatusLabel` (which returned a translated LABEL STRING
 * directly — `applicationCatalog.constants.js` callers,
 * `useApplicationCatalogState.hooks.js:14-19`). Model-layer code stays
 * i18n-free (R-T3 is a JSX-text/attribute rule; keeping translation at the
 * `ui/` call site, keyed off this discriminant, is the same "component
 * either renders or fetches, never both" separation spec §3.6 asks for).
 */
export type ApplicationAvailability = 'configured' | 'available' | 'byRequest';

/**
 * A catalog entry merged with its live toolkit-type schema/configuration
 * state — the view model `ApplicationCatalogCard` renders. Mirrors the
 * baseline's per-item object built in
 * `useApplicationCatalogState.hooks.js:46-89`.
 */
export interface CatalogApplication {
  readonly type: string;
  readonly name: string;
  readonly Icon: SvgIconComponent;
  readonly shortDescription: string;
  readonly description: string;
  readonly capabilities: readonly string[];
  readonly bestFor: string;
  readonly documentation: string;
  /** `schema.metadata.label` when a schema is registered, else the catalog entry's own name. */
  readonly typeLabel: string;
  /** A schema is registered for this toolkit type — the project can self-serve configure it. */
  readonly canCreate: boolean;
  /** At least one toolkit instance of this type already exists in the project. */
  readonly isConfigured: boolean;
  /** Not creatable and not yet configured — access must be requested. */
  readonly canRequest: boolean;
  readonly availability: ApplicationAvailability;
}
