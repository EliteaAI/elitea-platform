import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { AuthorNames } from './AuthorNames';

describe('AuthorNames', () => {
  it('renders nothing for an empty author list', () => {
    const { container } = renderWithTheme(<AuthorNames names={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders a single author name', () => {
    const { getByText } = renderWithTheme(<AuthorNames names={['Ada Lovelace']} />);
    expect(getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('joins multiple author names with a comma', () => {
    const { getByText } = renderWithTheme(<AuthorNames names={['Ada', 'Grace']} />);
    expect(getByText('Ada, Grace')).toBeInTheDocument();
  });
});
