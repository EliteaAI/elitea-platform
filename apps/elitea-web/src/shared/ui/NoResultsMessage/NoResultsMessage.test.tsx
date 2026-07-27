import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { NoResultsMessage } from '.';

describe('NoResultsMessage', () => {
  it('renders the title and description', () => {
    const { getByText } = renderWithTheme(
      <NoResultsMessage
        title="Nothing here"
        description="Adjust your filters"
      />,
    );
    expect(getByText('Nothing here')).toBeInTheDocument();
    expect(getByText('Adjust your filters')).toBeInTheDocument();
  });
});
