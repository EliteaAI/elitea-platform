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
  /**
   * The `ApplicationCatalogCard` title-tooltip text. Despite the name, this
   * is populated from the catalog entry's `shortDescription`, NOT its own
   * (longer) `description` copy — see `catalog.ts`'s `buildCatalogApplication`
   * doc comment for the baseline-parity reason.
   */
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
  /**
   * Not self-serve creatable — access must be requested. Mirrors the
   * baseline's real render-path formula (`ApplicationCatalog.jsx:55`,
   * `!application.canCreate && requestStatus !== PENDING`), which is
   * `isConfigured`-independent: an already-configured type with no
   * available creation schema is still requestable in the old app. See
   * `catalog.ts`'s `buildCatalogApplication` doc comment for why.
   */
  readonly canRequest: boolean;
  readonly availability: ApplicationAvailability;
}
