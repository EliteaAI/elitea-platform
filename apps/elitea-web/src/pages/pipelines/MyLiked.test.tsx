import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { MyLiked } from './MyLiked';

describe('MyLiked', () => {
  it('renders the disclosed composition-gap state, not a fabricated list', () => {
    const { getByTestId, getByText } = renderWithTheme(<MyLiked />);
    expect(getByTestId('pipelines-my-liked-unavailable')).toBeInTheDocument();
    expect(getByText('Liked pipelines are not available yet.')).toBeInTheDocument();
  });
});
