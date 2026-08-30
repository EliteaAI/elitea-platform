/**
 * SidebarFooter.test.tsx — regression coverage for the catalogue pill
 * (R1: `Buttons.AgentHubButton` in the old app's `SidebarBody.jsx`). The
 * pill was previously dropped from this widget on a now-stale "no page to
 * link to yet" justification.
 *
 * It reads "Catalog" and points at `/elitea-catalog`, matching the baseline
 * after `/agents-hub` became a redirect source: `AgentHubButton.jsx`
 * navigates to `RouteDefinitions.EliteaCatalog` and renders the literal
 * label `Catalog`. Linking the pill at `/agents-hub` would still WORK — the
 * redirect would catch it — which is exactly why this needs asserting: a
 * pill costing every click an extra history hop looks identical on screen.
 */
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderAtPath } from './testRouter';
import { SidebarFooter } from '../ui/SidebarFooter';

describe('SidebarFooter — Catalog pill (R1)', () => {
  it('always renders a "Catalog" link to /elitea-catalog, on an arbitrary page, next to Settings/Help Center', async () => {
    await renderAtPath('/chat', <SidebarFooter collapsed={false} />);
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Catalog')).toBeInTheDocument();
    expect(screen.getByText('Help Center')).toBeInTheDocument();
    expect(screen.getByTestId('sidebar-agent-hub-button')).toHaveAttribute('href', '/elitea-catalog');
  });

  it('does not link at the legacy /agents-hub redirect source', async () => {
    await renderAtPath('/chat', <SidebarFooter collapsed={false} />);
    expect(screen.getByTestId('sidebar-agent-hub-button')).not.toHaveAttribute('href', '/agents-hub');
  });

  it('still renders the Catalog pill when collapsed (icon-only, with a hover tooltip)', async () => {
    const user = userEvent.setup();
    await renderAtPath('/chat', <SidebarFooter collapsed />);
    const link = screen.getByTestId('sidebar-agent-hub-button');
    expect(link).toBeInTheDocument();
    expect(screen.queryByText('Catalog')).not.toBeInTheDocument();

    await user.hover(link);
    const tooltip = await screen.findByRole('tooltip', undefined, { timeout: 2000 });
    expect(tooltip).toHaveTextContent('Catalog');
  });

  it('marks the Catalog link as the active page (aria-current) when already on /elitea-catalog', async () => {
    await renderAtPath('/elitea-catalog', <SidebarFooter collapsed={false} />);
    expect(screen.getByTestId('sidebar-agent-hub-button')).toHaveAttribute('aria-current', 'page');
  });

  it('does not mark the Catalog link as active on other pages', async () => {
    await renderAtPath('/chat', <SidebarFooter collapsed={false} />);
    expect(screen.getByTestId('sidebar-agent-hub-button')).not.toHaveAttribute('aria-current');
  });
});

/**
 * ARIA-CURRENT ON A NON-EXACT ACTIVE LINK.
 *
 * TanStack's <Link> sets aria-current only when the path matches EXACTLY. The
 * Settings link points at /settings/model-configuration but is styled active
 * for every /settings/* route. On /settings/secrets the sidebar therefore
 * showed it selected. Assistive technology was told nothing was current.
 */
describe('SidebarFooter — the active page is announced, not only styled', () => {
  it('marks Settings as the current page on a settings child route', async () => {
    await renderAtPath('/settings/secrets', <SidebarFooter collapsed={false} />);
    expect(screen.getByText('Settings').closest('a')).toHaveAttribute('aria-current', 'page');
  });

  it('does not mark Settings as current on an unrelated route', async () => {
    await renderAtPath('/chat', <SidebarFooter collapsed={false} />);
    expect(screen.getByText('Settings').closest('a')).not.toHaveAttribute('aria-current');
  });

  it('marks Help Center as the current page on /help-center', async () => {
    await renderAtPath('/help-center', <SidebarFooter collapsed={false} />);
    expect(screen.getByText('Help Center').closest('a')).toHaveAttribute('aria-current', 'page');
  });
});
