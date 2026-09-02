import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { REQUEST_STATUS, applicationCatalog } from '../../lib/constants';
import { buildCatalogApplication } from '../../model/catalog';
import type { CatalogApplication } from '../../model/types';
import { renderWithProviders } from '../../__tests__/testUtils';

import { ApplicationCatalogCard } from './ApplicationCatalogCard';

const wikisEntry = applicationCatalog()[0]!;

function catalogApp(overrides: { schema?: boolean; configured?: boolean } = {}): CatalogApplication {
  const schemas = overrides.schema ? { [wikisEntry.type]: { metadata: { application: true, label: 'Wikis' } } } : {};
  const configured = new Set<string>(overrides.configured ? [wikisEntry.type] : []);
  return buildCatalogApplication(wikisEntry, schemas, configured);
}

function renderCard(props: Partial<Parameters<typeof ApplicationCatalogCard>[0]> = {}) {
  const onConfigure = vi.fn();
  const onRequestAccess = vi.fn();
  const view = renderWithProviders(
    <ApplicationCatalogCard
      application={catalogApp()}
      requestStatus={REQUEST_STATUS.NONE}
      isLoading={false}
      isFetchingStatus={false}
      onConfigure={onConfigure}
      onRequestAccess={onRequestAccess}
      {...props}
    />,
  );
  return { ...view, onConfigure, onRequestAccess };
}

describe('ApplicationCatalogCard', () => {
  it('renders the name, description sections and documentation link', () => {
    const { container } = renderCard();
    expect(screen.getByText('Wikis')).toBeInTheDocument();
    expect(container.textContent).toContain('Generate searchable wiki pages from repository code.');
    expect(container.textContent).toContain('Wiki generation, Architecture summaries, Code-aware Q&A');
    expect(container.textContent).toContain('Onboarding, implementation context, and team knowledge');
    const link = screen.getByRole('link', { name: /Documentation/ });
    expect(link).toHaveAttribute('href', wikisEntry.documentation);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('stops the documentation link click from bubbling past the card', async () => {
    const user = userEvent.setup();
    // A native `addEventListener` probe (not a JSX `onClick`) — avoids
    // rendering a non-interactive element with a click handler, which
    // `jsx-a11y` correctly flags as needing a keyboard affordance; this is
    // purely a bubbling probe, not a real interactive control.
    const ancestorClick = vi.fn();
    document.addEventListener('click', ancestorClick);
    try {
      renderCard();
      await user.click(screen.getByRole('link', { name: /Documentation/ }));
      expect(ancestorClick).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener('click', ancestorClick);
    }
  });

  it('shows a Configure button when a schema is registered, and calls onConfigure with the application', async () => {
    const user = userEvent.setup();
    const { onConfigure } = renderCard({ application: catalogApp({ schema: true }) });

    const configureButton = screen.getByRole('button', { name: 'Configure' });
    await user.click(configureButton);
    expect(onConfigure).toHaveBeenCalledWith(catalogApp({ schema: true }));
    expect(screen.queryByRole('button', { name: 'Request Access' })).not.toBeInTheDocument();
  });

  it('disables the Configure button while the catalogue is loading', () => {
    renderCard({ application: catalogApp({ schema: true }), isLoading: true });
    expect(screen.getByRole('button', { name: 'Configure' })).toBeDisabled();
  });

  it('shows a Request Access button when the type is neither creatable nor configured, and calls onRequestAccess', async () => {
    const user = userEvent.setup();
    const { onRequestAccess } = renderCard();

    const requestButton = screen.getByRole('button', { name: 'Request Access' });
    await user.click(requestButton);
    expect(onRequestAccess).toHaveBeenCalledWith(catalogApp());
    expect(screen.queryByRole('button', { name: 'Configure' })).not.toBeInTheDocument();
  });

  it('shows "Pending approval" instead of the Request Access button when a request is pending', () => {
    renderCard({ requestStatus: REQUEST_STATUS.PENDING });
    expect(screen.getByText('Pending approval')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request Access' })).not.toBeInTheDocument();
  });

  it('hides Configure but still shows Request Access when the type is already configured but not self-serve creatable (baseline: canRequest ignores isConfigured — model/catalog.ts)', () => {
    renderCard({ application: catalogApp({ configured: true }) });
    expect(screen.queryByRole('button', { name: 'Configure' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request Access' })).toBeInTheDocument();
  });

  it('shows a loading spinner instead of any action while fetching moderation status', () => {
    renderCard({ isFetchingStatus: true });
    expect(screen.queryByRole('button', { name: 'Request Access' })).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });
});
