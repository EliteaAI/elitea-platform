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
