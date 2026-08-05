/**
 * SupportAssistantWidget — the visible widget component.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/widgets/support-assistant/ui/SupportAssistant.jsx`.
 *
 * KEY DECISION #3 (issue #26): this widget renders a no-op shell when
 * `@eliteaai/elitea-assistant` is not available in the new app's
 * dependencies. When the assistant package is installed, it renders the
 * actual floating assistant with the same configuration shape.
 *
 * The widget:
 * 1. Reads the `useGetSupportAssistantConfigQuery` to determine if the
 *    assistant should be shown.
 * 2. Wraps children with `SupportAssistantProvider` that exposes
 *    `onToggleAssistant` via render props.
 * 3. Conditionally renders the `@eliteaai/elitea-assistant` component.
 */
import { memo, useCallback, useRef, type ReactNode } from 'react';

import { SupportAssistantProvider } from '../lib/SupportAssistantContext';
import { useGetSupportAssistantConfigQuery } from '../api/supportAssistantConfigApi';

interface SupportAssistantWidgetChildrenProps {
  /**
   * Toggle function — provided only when the assistant is enabled.
   * Consumers (e.g. AppShell) call this to open/close the assistant.
   */
  onToggleAssistant?: (() => void) | undefined;
}

/**
 * Props for the SupportAssistantWidget component.
 */
export interface SupportAssistantWidgetProps {
  /** Children render function that receives `onToggleAssistant`. */
  children: (props: SupportAssistantWidgetChildrenProps) => ReactNode;
}

/**
 * Reads the config and returns a boolean indicating if the assistant is enabled.
 *
 * Falls back to `false` when the query is not enabled or fails.
 */
function useSupportAssistantEnabled(options?: { enabled?: boolean }): boolean {
  const { data, isSuccess } = useGetSupportAssistantConfigQuery(options);

  if (!isSuccess) return false;
  return data?.enabled ?? false;
}

/**
 * Main support assistant widget component.
 *
 * In the baseline app this mounts `<EliteaAssistant>` from
 * `@eliteaai/elitea-assistant`. The new app does not yet have that
 * dependency, so this component renders its children without the
 * floating overlay until the dependency is added.
 */
export const SupportAssistantWidget = memo(({ children }: SupportAssistantWidgetProps): ReactNode => {
  const assistantRef = useRef<null | { toggle: () => void }>(null);
  const assistantEnabled = useSupportAssistantEnabled();

  const onToggleAssistant = useCallback(() => {
    assistantRef.current?.toggle();
  }, []);

  const toggle = assistantEnabled ? onToggleAssistant : undefined;

  return (
    <SupportAssistantProvider assistantRef={assistantRef as never}>
      {children({ onToggleAssistant: toggle })}

      {/*
       * PLACEHOLDER for `@eliteaai/elitea-assistant`.
       *
       * When the package is installed and the endpoint is wired:
       *
       * <EliteaAssistant
       *   ref={assistantRef}
       *   apiUrl={`${clearBaseUrlPrefix(VITE_SERVER_URL)}/support_assistant`}
       *   withCredentials={!DEV}
       *   position="bottom-left"
       *   theme={theme.palette.mode}
       *   supportAssistantContext={assistantContext}
       * />
       *
       * The context object would be built by a `useAssistantContext` hook
       * (currently in the baseline's `lib/hooks/useAssistantContext.hooks.js`)
       * that reads Redux state (project, page type, current chat model, etc.)
       * and builds the context payload the assistant sends with each message.
       */}
    </SupportAssistantProvider>
  );
});

SupportAssistantWidget.displayName = 'SupportAssistantWidget';
