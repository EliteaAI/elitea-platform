import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { Trending } from './Trending';

describe('Trending', () => {
  it('renders the disclosed composition-gap state, not a fabricated list', () => {
    const { getByTestId, getByText } = renderWithTheme(<Trending />);
    expect(getByTestId('pipelines-trending-unavailable')).toBeInTheDocument();
    expect(getByText('Trending pipelines are not available yet.')).toBeInTheDocument();
  });
});
