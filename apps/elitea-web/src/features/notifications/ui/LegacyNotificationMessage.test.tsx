import { describe, expect, it, vi } from 'vitest';

import { screen } from '@testing-library/react';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import type { FullNotificationMeta } from '../api/normalize';
import { LegacyNotificationMessage } from './LegacyNotificationMessage';

describe('LegacyNotificationMessage', () => {
  it('renders null when meta is undefined', () => {
    const { container } = renderWithTheme(
      <LegacyNotificationMessage
        eventType="rates"
        meta={undefined}
        projectId="7"
        textVariant="bodySmall"
        textColor="inherit"
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the composed leading/link/ending text for a fully-mapped event type', () => {
    // token_expiring is the leadingText(...)-mapped member of the
    // "Configuration link" group (legacyText.ts's parseConfigurationLink) —
    // author_approval/moderator_unpublish/etc. share the SAME firstLinkInfo
    // shape but have NO leadingText(...) entry at all (verbatim baseline
    // gap, notificationLegacy.helpers.js:8-20), so they render no leading
    // text; token_expiring is picked here specifically because it DOES.
    const meta: FullNotificationMeta = { tokenName: 'MyToken' };
    renderWithTheme(
      <LegacyNotificationMessage
        eventType="token_expiring"
        meta={meta}
        projectId="7"
        textVariant="bodySmall"
        textColor="inherit"
      />,
    );
    expect(screen.getByText(/Token MyToken/)).toBeInTheDocument();
    // 'Configuration' link text renders but is NOT a clickable link — see
    // LegacyLink's doc comment: no urlMap entry exists for this event type
    // in the baseline (a pre-existing dead link), so it's plain text here.
    expect(screen.getByText('Configuration')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Configuration' })).toBeNull();
  });

  it('renders no leading text for a Configuration-link event type that has no leadingText(...) entry (e.g. author_approval)', () => {
    const meta: FullNotificationMeta = { tokenName: 'MyToken' };
    renderWithTheme(
      <LegacyNotificationMessage
        eventType="author_approval"
        meta={meta}
        projectId="7"
        textVariant="bodySmall"
        textColor="inherit"
      />,
    );
    expect(screen.queryByText(/MyToken/)).toBeNull();
    expect(screen.getByText('Configuration')).toBeInTheDocument();
  });

  it('agent_unpublished: renders a real new-tab link for the version id', () => {
    const meta: FullNotificationMeta = { sourceApplicationId: 'a1', sourceVersionId: 'v1', reason: 'policy' };
    renderWithTheme(
      <LegacyNotificationMessage
        eventType="agent_unpublished"
        meta={meta}
        projectId="7"
        textVariant="bodySmall"
        textColor="inherit"
      />,
    );
    const link = screen.getByRole('link', { name: 'v1' });
    expect(link.getAttribute('href')).toContain('/7/agents/all/a1/v1?viewMode=owner');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByText(/from project id: 7\. Reason: policy/)).toBeInTheDocument();
  });

  it('agent_unpublished: falls back to an empty project id in the trailing text when the notification carries none', () => {
    const meta: FullNotificationMeta = { sourceApplicationId: 'a1', sourceVersionId: 'v1' };
    renderWithTheme(
      <LegacyNotificationMessage
        eventType="agent_unpublished"
        meta={meta}
        projectId={undefined}
        textVariant="bodySmall"
        textColor="inherit"
      />,
    );
    expect(screen.getByText(/from project id: \./)).toBeInTheDocument();
  });

  it('agent_unpublished: renders plain text (no link) when sourceApplicationId/sourceVersionId are missing', () => {
    renderWithTheme(
      <LegacyNotificationMessage
        eventType="agent_unpublished"
        meta={{}}
        projectId="7"
        textVariant="bodySmall"
        textColor="inherit"
      />,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('index_data_changed with a new-tab link: renders a real, clickable link', () => {
    const meta: FullNotificationMeta = { toolkitId: 't1', indexName: 'idx' };
    renderWithTheme(
      <LegacyNotificationMessage
        eventType="index_data_changed"
        meta={meta}
        projectId="7"
        textVariant="bodySmall"
        textColor="inherit"
      />,
    );
    const link = screen.getByRole('link', { name: 'idx' });
    expect(link.getAttribute('href')).toContain('/7/toolkits/indexes/t1');
  });

  it('calls onCloseNotificationList when a new-tab link is clicked', () => {
    const onClose = vi.fn();
    const meta: FullNotificationMeta = { toolkitId: 't1', indexName: 'idx' };
    renderWithTheme(
      <LegacyNotificationMessage
        eventType="index_data_changed"
        meta={meta}
        projectId="7"
        onCloseNotificationList={onClose}
        textVariant="bodySmall"
        textColor="inherit"
      />,
    );
    screen.getByRole('link', { name: 'idx' }).click();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('returns {} (blank render) for an event type parseLegacyInformation does not handle', () => {
    const { container } = renderWithTheme(
      <LegacyNotificationMessage
        eventType="moderation_approved"
        meta={{}}
        projectId="7"
        textVariant="bodySmall"
        textColor="inherit"
      />,
    );
    expect(container.textContent).toBe('');
  });
});
