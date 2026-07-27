/**
 * Public surface of the app-wide provider composition (spec §3.2; §9.3 unit
 * R2). `App.tsx` imports `AppProviders` from here; nothing else in the tree
 * should import a deeper path into this directory.
 */

/** The composed provider root — see `AppProviders.tsx` for the nesting order and its rationale. */
export { AppProviders } from './AppProviders';
export type { AppProvidersProps } from './AppProviders';

/** @public Wave-1 surface — the dedicated export unit R1 reads for `createRouter({ basename })`. */
export { getAppBasename } from './basename';

/** @public Wave-1 surface — exposed for a future Storybook decorator / e2e harness that needs R2's exact query defaults. */
export { createAppQueryClient, QUERY_DEFAULT_OPTIONS } from './queryClient';

/** @public Wave-1 surface — exposed for a future story/e2e case that asserts the fallback UI in isolation. */
export { AppErrorBoundary } from './ErrorBoundary';
export type { AppErrorBoundaryProps } from './ErrorBoundary';

/** @public Wave-1 surface — the channel-C (unit W3) per-tenant pack extension point; see `BrandThemeProvider.tsx`'s `pack` prop. */
export { BrandThemeProvider } from './BrandThemeProvider';
export type { BrandThemeProviderProps } from './BrandThemeProvider';
