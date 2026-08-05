/**
 * widgets/support-assistant — public API surface for the support assistant.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/widgets/support-assistant/` (the
 * barrel index and all supporting modules).
 *
 * KEY DECISION #3 (issue #26): this unit builds the public API
 * (`useEliteaAssistantRef` + `useGetSupportAssistantConfigQuery`) only.
 * Wiring the widget into `AppShell` or `CredentialWarningBanner` is
 * **OUT OF SCOPE** (W-shell / credentials units).
 *
 * NOTE: the actual `@eliteaai/elitea-assistant` React component requires
 * the package to be listed in `apps/elitea-web/package.json`. Until that
 * dependency lands, the widget is a no-op shell that always renders its
 * children without overlay.
 */
export { useGetSupportAssistantConfigQuery } from './api/supportAssistantConfigApi';
export { useEliteaAssistantRef, SupportAssistantProvider } from './lib/SupportAssistantContext';
export type { EliteaAssistantInstance } from './lib/SupportAssistantContext';
/*
 * The widget itself was missing from this barrel — an omission, not a
 * deliberate exclusion: the doc comment above describes the unit as building
 * "the public API", and every other widget slice exports its widget component.
 * Leaving it off is what made knip (#71) report the file as unused. Wiring it
 * into `AppShell` remains the W-shell unit's job (that component's own doc
 * comment lists `SupportAssistantWidget` under what it deliberately dropped),
 * and mounting it today would render nothing anyway — the real
 * `@eliteaai/elitea-assistant` overlay is not a dependency of this app, so the
 * widget is still the no-op passthrough shell described above.
 */
export { SupportAssistantWidget } from './ui/SupportAssistantWidget';
export type { SupportAssistantWidgetProps } from './ui/SupportAssistantWidget';
