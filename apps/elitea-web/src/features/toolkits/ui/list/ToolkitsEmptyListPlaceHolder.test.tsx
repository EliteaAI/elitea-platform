import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CollectionStatus } from '@/shared/lib/sort-status';

import { renderWithProviders } from '../../__tests__/testUtils';
import { ToolkitsEmptyListPlaceHolder } from './ToolkitsEmptyListPlaceHolder';

describe('ToolkitsEmptyListPlaceHolder', () => {
  it('shows the "nothing found" message when a query is present, regardless of status', () => {
    // The baseline (and this port) renders `{leading} <br /> {trailing}` as
    // three separate text-node siblings under one `Box` — no wrapping
    // element around either half — so `getByText` needs a regex (matched
    // against the whole element's normalized text) rather than an exact
    // string match against a nonexistent single-text-node element.
    renderWithProviders(<ToolkitsEmptyListPlaceHolder query="react" />);
    expect(screen.getByText(/Nothing found\./)).toBeInTheDocument();
    expect(screen.getByText(/Create yours now!/)).toBeInTheDocument();
  });

  it('shows "You have no toolkits." with no status and no query', () => {
    renderWithProviders(<ToolkitsEmptyListPlaceHolder />);
    expect(screen.getByText('You have no toolkits.')).toBeInTheDocument();
  });

  it('shows "You have no MCPs." when isMCP is true', () => {
    renderWithProviders(<ToolkitsEmptyListPlaceHolder isMCP />);
    expect(screen.getByText('You have no MCPs.')).toBeInTheDocument();
  });

  it.each([
    [CollectionStatus.UserApproval, 'You have no approval toolkits.'],
    [CollectionStatus.Draft, 'You have no draft toolkits.'],
    [CollectionStatus.OnModeration, 'You have no toolkits on moderation.'],
    [CollectionStatus.Rejected, 'You have no rejected toolkits.'],
    [CollectionStatus.Published, 'You have no published toolkits.'],
  ])('renders the correct message for status=%s', (status, expected) => {
    renderWithProviders(<ToolkitsEmptyListPlaceHolder status={status} />);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });
});
