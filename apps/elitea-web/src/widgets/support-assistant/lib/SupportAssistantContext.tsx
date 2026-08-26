/**
 * Context provider and ref hook for the support assistant.
 *
 * Ported from `apps/elitea-ui/src/[fsd]/widgets/support-assistant/lib/context/EliteaAssistantContext.jsx`
 * and `apps/elitea-ui/src/[fsd]/widgets/support-assistant/lib/context/index.js`.
 *
 * Provides a mutable ref to the underlying `@eliteaai/elitea-assistant`
 * instance so that consumers (AppShell, widgets, etc.) can call
 * `toggle()` / `open()` / `close()` imperatively.
 */
import { createContext, useContext, type MutableRefObject, type ReactNode } from 'react';

import type { TEliteaAssistantRef } from '../vendor/lib/types';

/**
 * The assistant component's imperative handle.
 *
 * It USED TO BE a three-method stand-in — "a minimal interface matching the
 * methods consumed by the baseline's `SupportAssistantWidget`" — because the
 * real type lived in a package this app did not depend on. The widget's source
 * is ported under `../vendor/` now, so this is an ALIAS of the real handle
 * rather than a guess at it.
 *
 * That matters beyond tidiness: a structural subset type still satisfies
 * `useContext`, but it does NOT satisfy `ref=` on the component itself, so the
 * stand-in would have quietly forced a cast at the one place the ref is actually
 * attached — the place where being wrong about the handle's shape is a runtime
 * error rather than a type error.
 */
export type EliteaAssistantInstance = TEliteaAssistantRef;

/**
 * Context providing a mutable ref to the assistant instance.
 * Consumers call `useEliteaAssistantRef()` to access the ref.
 */
const EliteaAssistantContext = createContext<MutableRefObject<EliteaAssistantInstance | null> | null>(null);

/*
 * Deliberately NOT exported: the baseline's own barrel
 * (`[fsd]/widgets/support-assistant/lib/context/index.js`) exposes only
 * `EliteaAssistantProvider` + `useEliteaAssistantRef`, never the raw context
 * object. `SupportAssistantProvider` and `useEliteaAssistantRef` below are the
 * whole public surface; a direct `useContext(EliteaAssistantContext)` by a
 * consumer would bypass the null-check contract the hook documents.
 */

/**
 * Context provider that supplies the assistant instance ref.
 *
 * The `assistantRef` is typically set by the actual `@eliteaai/elitea-assistant`
 * component's `ref` prop. When the assistant component is not yet installed,
 * callers can pass a no-op ref.
 */
export function SupportAssistantProvider({
  assistantRef,
  children,
}: {
  assistantRef: MutableRefObject<EliteaAssistantInstance | null>;
  children: ReactNode;
}): ReactNode {
  return (
    <EliteaAssistantContext.Provider value={assistantRef}>
      {children}
    </EliteaAssistantContext.Provider>
  );
}

/**
 * Hook to access the assistant instance ref from any descendant.
 *
 * Returns `null` if called outside the provider (safety gate for
 * components wired before the provider is mounted).
 */
export function useEliteaAssistantRef(): MutableRefObject<EliteaAssistantInstance | null> | null {
  return useContext(EliteaAssistantContext);
}
