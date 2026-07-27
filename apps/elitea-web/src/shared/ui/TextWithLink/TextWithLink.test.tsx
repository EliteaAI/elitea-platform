import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { TextWithLink } from '.';

describe('TextWithLink', () => {
  it('renders text, link and suffix', () => {
    const { getByText, getByRole } = renderWithTheme(
      <TextWithLink
        text="See the"
        linkUrl="https://example.com"
        linkText="guide"
        suffix=" now."
      />,
    );
    expect(getByText('See the', { exact: false })).toBeInTheDocument();
    expect(getByRole('link', { name: 'guide' })).toHaveAttribute('href', 'https://example.com');
    expect(getByText(/now\./)).toBeInTheDocument();
  });

  it('opens the link in a new tab safely', () => {
    const { getByRole } = renderWithTheme(
      <TextWithLink
        text="a"
        linkUrl="https://example.com"
        linkText="link"
      />,
    );
    const link = getByRole('link', { name: 'link' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
