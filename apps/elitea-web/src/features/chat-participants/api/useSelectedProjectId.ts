/**
 * "Currently selected project id" for the chat-participants feature.
 *
 * Local copy — `no-sideways-features` forbids importing from
 * `features/chat-input/api/useSelectedProjectId` or any other feature slice.
 * Byte-for-byte identical to `features/chat-input/api/useSelectedProjectId.ts`.
 */
import { useRouteContext } from '@tanstack/react-router';

/** Structural, not nominal — the router's registered context type is not imported; this only requires the one method this hook actually calls. */
interface SelectedProjectIdContext {
  readonly auth?: {
    readonly getSelectedProjectId?: () => string | undefined;
  };
}

function isSelectedProjectIdContext(value: unknown): value is SelectedProjectIdContext {
  return typeof value === 'object' && value !== null;
}

export function selectProjectId(context: unknown): string | undefined {
  if (!isSelectedProjectIdContext(context)) return undefined;
  return context.auth?.getSelectedProjectId?.();
}

export function useSelectedProjectId(): string | undefined {
  const context: unknown = useRouteContext({ strict: false });
  return selectProjectId(context);
}
