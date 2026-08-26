/**
 * SupportAssistantWidget — the mount point for the in-app support assistant.
 *
 * # What changed, and why this file no longer says what it used to
 *
 * This component used to be a NO-OP SHELL. Its own body explained why: the
 * published `@eliteaai/elitea-assistant` package was not a dependency of this
 * app, so there was nothing to render, and the widget passed its children
 * through with `onToggleAssistant` left undefined. The admin Features page said
 * the same thing in its `unavailable_reason` — "enabling it would change a flag
 * no rendered surface reads".
 *
 * The package still is not a dependency, and that is deliberate rather than
 * unfinished: it streams a turn over socket.io, and this platform serves SSE.
 * The widget's source is PORTED into `../vendor/` instead, with its transport
 * replaced — see `../vendor/lib/hooks/stream.hook.ts` for exactly what that
 * changes and what it costs.
 *
 * # Why this component still exists rather than mounting the vendor root directly
 *
 * Three jobs that belong to the app, not to a vendored widget:
 *
 *  1. IT DECIDES WHETHER TO MOUNT AT ALL. `GET /support_assistant/config`
 *     answers `enabled: false` for every deployment that has the feature off,
 *     has no hidden support project, or has no agent chosen. Mounting the
 *     assistant regardless and letting it discover this internally would put a
 *     floating button on every page of every deployment that never enabled it.
 *  2. IT SUPPLIES THE PAGE CONTEXT — which screen, which project, which entity —
 *     which only the app knows. See `../lib/useAssistantContext`.
 *  3. IT PUBLISHES THE IMPERATIVE REF so other slices can open the assistant
 *     (`CredentialWarningBanner`'s `onMount` is the baseline's caller) without
 *     reaching into `../vendor/`.
 *
 * # The render-prop shape is kept
 *
 * `children` is still a function receiving `onToggleAssistant`, and it is still
 * `undefined` when the assistant is not available. That is what lets a caller
 * render a "Ask support" affordance only when there is something to open — and
 * it means AppShell's call site did not have to change shape when this stopped
 * being a shell.
 */
import { memo, useCallback, useRef, type ReactNode } from 'react';

import { useAssistantContext, type AssistantContextProject } from '../lib/useAssistantContext';
import { SupportAssistantProvider, type EliteaAssistantInstance } from '../lib/SupportAssistantContext';
import { useGetSupportAssistantConfigQuery } from '../api/supportAssistantConfigApi';
import { EliteaAssistant } from '../vendor/EliteaAssistant';

interface SupportAssistantWidgetChildrenProps {
  /**
   * Toggle function — provided only when the assistant is enabled. Consumers
   * (e.g. AppShell) call this to open/close the assistant.
   */
  onToggleAssistant?: (() => void) | undefined;
}

/** Props for the SupportAssistantWidget component. */
export interface SupportAssistantWidgetProps {
  /** Children render function that receives `onToggleAssistant`. */
  children: (props: SupportAssistantWidgetChildrenProps) => ReactNode;
  /**
   * Which corner the floating button sits in. The baseline mounts it
   * `bottom-left`, out of the way of the chat surface's own controls.
   */
  position?: 'bottom-right' | 'bottom-left' | undefined;
  /**
   * The project the shell has selected, for the context payload.
   *
   * PASSED IN RATHER THAN READ HERE, and the reason is a cycle: the selected
   * project lives in `widgets/app-shell`'s store, and `widgets/app-shell` is the
   * thing that mounts this widget. Importing its barrel from here would make the
   * two widget barrels import each other.
   */
  project?: AssistantContextProject | undefined;
}

export const SupportAssistantWidget = memo(
  ({ children, position = 'bottom-left', project }: SupportAssistantWidgetProps): ReactNode => {
    const assistantRef = useRef<EliteaAssistantInstance | null>(null);
    const { data, isSuccess } = useGetSupportAssistantConfigQuery();
    const assistantContext = useAssistantContext(project);

    const enabled = isSuccess && Boolean(data?.enabled);

    const onToggleAssistant = useCallback(() => {
      assistantRef.current?.toggle();
    }, []);

    return (
      <SupportAssistantProvider assistantRef={assistantRef}>
        {children({ onToggleAssistant: enabled ? onToggleAssistant : undefined })}
        {enabled && (
          <EliteaAssistant
            ref={assistantRef}
            position={position}
            supportAssistantContext={assistantContext}
            // Handed down rather than re-fetched: this component only renders
            // the assistant BECAUSE of this document, so the widget asking for
            // it again would be a second request for an answer already in hand.
            config={data}
          />
        )}
      </SupportAssistantProvider>
    );
  },
);

SupportAssistantWidget.displayName = 'SupportAssistantWidget';
