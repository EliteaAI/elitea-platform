import type { ReactNode } from 'react';
import { useEffect } from 'react';

import { useBlocker } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';

import { BaseModal } from '@/shared/ui/BaseModal';
import { t } from '@/shared/i18n';

import { useNavBlockerStore } from '../model/navBlocker.store';

/**
 * The navigation blocker (task brief: "a navigation blocker (unsaved-changes
 * guard)"). Ported from `components/UnsavedDialog.jsx`.
 *
 * TanStack Router's `useBlocker({ shouldBlockFn, withResolver: true })`
 * (verified against the installed `@tanstack/react-router@1.170.18`
 * typings, `useBlocker.d.ts`) is a strictly more robust replacement for the
 * old app's react-router `useBlocker` + `BLOCK_NAV_PATTERNS`
 * path-allowlist: it fires for EVERY navigation attempt through the router
 * (including `widgets/sidebar`'s `<Link>` clicks and
 * `widgets/create-button`'s `navigate()` calls) with no per-call-site
 * wiring needed, so `SidebarBody`'s old per-click `navigateToPage` special
 * case (SHELL-011's "defers API cache reset" half — see `widgets/sidebar`'s
 * header) does not need re-implementing here.
 *
 * `BLOCK_NAV_PATTERNS` (the old app's path-allowlist — only certain routes
 * are "blockable") is NOT reproduced: no landed Wave-2 unit owns an editor
 * page yet, so there is no path list to allowlist against. `shouldBlockFn`
 * therefore blocks on `isBlockNav || isStreaming` alone, for ANY
 * navigation — the safe default once a real editor sets those flags
 * (blocking too broadly is the fail-safe direction; the old app's
 * allowlist existed to avoid blocking on genuinely safe pages, which today
 * never set the flags in the first place, so the allowlist has no
 * observable effect yet either way).
 */
export function NavBlockerDialog(): ReactNode {
  const isBlockNav = useNavBlockerStore((state) => state.isBlockNav);
  const isStreaming = useNavBlockerStore((state) => state.isStreaming);
  const warningMessage = useNavBlockerStore((state) => state.warningMessage);
  const setBlockNav = useNavBlockerStore((state) => state.setBlockNav);
  const setStreamingBlockNav = useNavBlockerStore((state) => state.setStreamingBlockNav);
  const queryClient = useQueryClient();

  const { status, proceed, reset } = useBlocker({
    shouldBlockFn: () => isBlockNav || isStreaming,
    withResolver: true,
  });

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent): void {
      if (!isBlockNav && !isStreaming) return;
      event.preventDefault();
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isBlockNav, isStreaming]);

  const handleConfirm = (): void => {
    proceed?.();
    queryClient.clear();
    setBlockNav(false);
    setStreamingBlockNav(false, 'prompt');
  };

  // `reset` is `(() => void) | undefined` per `BlockerResolver`'s
  // discriminated union (`undefined` only in the 'idle' branch — reachable
  // here only in the instant before `status` itself has caught up, since
  // `open` is driven by that same `status`). `BaseModalProps.onClose` is
  // `(() => void) | undefined` too (no-`exactOptionalPropertyTypes`
  // widening needed) but TS cannot narrow one destructured binding from
  // another's value, so a same-shaped fallback keeps the boundary honest
  // instead of asserting reset is always defined.
  const handleClose = reset ?? (() => {});

  return (
    <BaseModal
      variant="simple"
      open={status === 'blocked'}
      title={t('widgets.appShell.navBlocker.title', 'Warning')}
      content={warningMessage}
      onClose={handleClose}
      onConfirm={handleConfirm}
      actions={{ alarm: true }}
      data-testid="nav-blocker-dialog"
    />
  );
}
