import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { MyLiked } from './MyLiked';

describe('MyLiked', () => {
  it('renders the disclosed composition-gap state, not a fabricated list', () => {
    const { getByTestId, getByText } = renderWithTheme(<MyLiked />);
    expect(getByTestId('agents-my-liked-unavailable')).toBeInTheDocument();
    expect(getByText('Liked agents are not available yet.')).toBeInTheDocument();
  });
});
