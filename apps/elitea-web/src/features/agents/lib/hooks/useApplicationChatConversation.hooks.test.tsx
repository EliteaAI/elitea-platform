import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '../../__tests__/testUtils';

import type { ChatApplicationVersionDetails } from './applicationChat.types';
import { useApplicationChatConversation } from './useApplicationChatConversation.hooks';

/**
 * Regression test for a CRITICAL infinite-render-loop bug: `applicationParticipant`
 * (this file's own `useMemo`) used to depend on `applicationVersionDetails` by object
 * identity. A caller that hands this hook a NEW-but-equal `applicationVersionDetails`
 * object on every render (e.g. a Formik-backed parent spreading `values.version_details`
 * into a fresh object each render — the exact shape `Harness` below reproduces) made the
 * memo recompute every render, which made `useSyncParticipantEffect` treat the participant
 * as "changed" and call `setActiveConversation` every render, which re-rendered the
 * component, which built a new `applicationVersionDetails` again — forever. Independently
 * reproduced live: React's nested-update guard eventually throws "Maximum update depth
 * exceeded" (at 302 renders in the live repro). This test fails the same way if the
 * `useMemo`/effect dependency stabilization in `useApplicationChatConversation.hooks.ts`
 * is reverted to depending on `applicationVersionDetails` directly.
 */
describe('useApplicationChatConversation — infinite render loop regression', () => {
  it('does not loop when applicationVersionDetails is a new-but-equal object every render', async () => {
    let renderCount = 0;

    function Harness(): null {
      renderCount += 1;

      // A brand-new object with EQUAL content every render — exactly what an unmemoized
      // parent (e.g. a form library spreading its values) would hand this hook.
      const applicationVersionDetails: ChatApplicationVersionDetails = {
        id: 'version-1',
        welcome_message: 'Hi there',
        variables: [{ name: 'x', value: '1' }],
        agent_type: 'chat',
        meta: { icon_meta: { url: 'icon.png' } },
      };

      useApplicationChatConversation({
        applicationId: 'app-1',
        applicationName: 'Test App',
        applicationVersionDetails,
        projectId: 'project-1',
        source: 'agent',
        restoredConversationID: null,
        restoredConversationData: undefined,
        isLoadingRestoredConversation: false,
        isErrorRestoredConversation: false,
        onRestoreConversationComplete: () => {},
      });

      return null;
    }

    act(() => {
      renderWithProviders(<Harness />);
    });

    // Flush any remaining microtasks/effects.
    await act(async () => {
      await Promise.resolve();
    });

    // A healthy mount settles after a small, bounded number of renders (participant
    // resolution, conversation creation, welcome-message injection). A regressed
    // version either throws "Maximum update depth exceeded" from inside the `act()`
    // calls above, or (if it hasn't hit that guard yet) leaves `renderCount` far past
    // any plausible bounded-settle count.
    expect(renderCount).toBeLessThan(20);
  });
});
