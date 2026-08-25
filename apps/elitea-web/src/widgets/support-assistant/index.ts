/**
 * widgets/support-assistant — the in-app support assistant.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/widgets/support-assistant/`, whose own
 * barrel exposed `useEliteaAssistantRef` and the config query.
 *
 * The unit's ORIGINAL scope note said the widget built "the public API only",
 * that wiring it into `AppShell` was out of scope, and that mounting it would
 * render nothing anyway because `@eliteaai/elitea-assistant` was not a
 * dependency. That is all resolved: the widget's source is ported under
 * `./vendor/` with its socket.io transport replaced by this platform's SSE
 * stream, and `widgets/app-shell` mounts it. See
 * `./ui/SupportAssistantWidget.tsx` for the full account.
 *
 * `./vendor/**` is DELIBERATELY NOT RE-EXPORTED. It is a ported third-party
 * widget, and the only supported way into it is `SupportAssistantWidget`, which
 * owns the decisions the app has to make on its behalf — whether to mount at
 * all, what page context to send, and who may hold the imperative ref.
 */
export { useGetSupportAssistantConfigQuery } from './api/supportAssistantConfigApi';
export { useEliteaAssistantRef, SupportAssistantProvider } from './lib/SupportAssistantContext';
export type { EliteaAssistantInstance } from './lib/SupportAssistantContext';
export { SupportAssistantWidget } from './ui/SupportAssistantWidget';
export type { SupportAssistantWidgetProps } from './ui/SupportAssistantWidget';
export { useAssistantContext, deriveAssistantPageContext } from './lib/useAssistantContext';
export type { AssistantContextProject } from './lib/useAssistantContext';
