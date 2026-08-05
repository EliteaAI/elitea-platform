/**
 * SidebarFooter.test.tsx — regression coverage for the "Agent HUB" pill
 * (R1: `Buttons.AgentHubButton` in the old app's `SidebarBody.jsx`). The
 * pill was previously dropped from this widget on a now-stale "no page to
 * link to yet" justification; `/agents-hub` (`src/routes/_shell/
 * agents-hub.tsx` -> `src/pages/agents-hub/AgentHub.tsx`) has since landed,
 * so it is wired back in unconditionally, same as Settings/Help Center.
 */
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderAtPath } from './testRouter';
import { SidebarFooter } from '../ui/SidebarFooter';

describe('SidebarFooter — Agent HUB pill (R1)', () => {
  it('always renders an "Agent HUB" link to /agents-hub, on an arbitrary page, next to Settings/Help Center', async () => {
    await renderAtPath('/chat', <SidebarFooter collapsed={false} />);
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Agent HUB')).toBeInTheDocument();
    expect(screen.getByText('Help Center')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-agent-hub-button')).toHaveAttribute('href', '/agents-hub');
  });

  it('still renders the Agent HUB pill when collapsed (icon-only, with a hover tooltip)', async () => {
    const user = userEvent.setup();
    await renderAtPath('/chat', <SidebarFooter collapsed />);
    const link = screen.getByTestId('sidebar-agent-hub-button');
    expect(link).toBeInTheDocument();
    expect(screen.queryByText('Agent HUB')).not.toBeInTheDocument();

    await user.hover(link);
    const tooltip = await screen.findByRole('tooltip', undefined, { timeout: 2000 });
    expect(tooltip).toHaveTextContent('Agent HUB');
  });

  it('marks the Agent HUB link as the active page (aria-current) when already on /agents-hub', async () => {
    await renderAtPath('/agents-hub', <SidebarFooter collapsed={false} />);
    expect(screen.getByTestId('sidebar-agent-hub-button')).toHaveAttribute('aria-current', 'page');
  });

  it('does not mark the Agent HUB link as active on other pages', async () => {
    await renderAtPath('/chat', <SidebarFooter collapsed={false} />);
    expect(screen.getByTestId('sidebar-agent-hub-button')).not.toHaveAttribute('aria-current');
  });
});
