import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { HeadingChip } from '.';

describe('HeadingChip', () => {
  it('renders the label text', () => {
    const { getByText } = renderWithTheme(<HeadingChip label="Templates" />);
    expect(getByText('Templates')).toBeInTheDocument();
  });

  it('renders the label with the subtitle typography variant class', () => {
    const { getByText } = renderWithTheme(<HeadingChip label="Templates" />);
    // `subtitle` is a custom (non-built-in) typography variant with no
    // `variantMapping` entry, so MUI's default fallback renders it as a
    // <span> — this is correct per R-C2, which only mandates real heading
    // tags for headingLarge/Medium/Small, not for label-style variants.
    expect(getByText('Templates').tagName).toBe('SPAN');
    expect(getByText('Templates').className).toMatch(/MuiTypography-subtitle/);
  });
});
