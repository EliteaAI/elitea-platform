import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { GradientIconWrapper } from '.';

describe('GradientIconWrapper', () => {
  it('renders its children', () => {
    const { getByText } = renderWithTheme(<GradientIconWrapper>AI</GradientIconWrapper>);
    expect(getByText('AI')).toBeInTheDocument();
  });

  it('defaults to a 2.75rem frame', () => {
    const { getByText } = renderWithTheme(<GradientIconWrapper>AI</GradientIconWrapper>);
    expect(getByText('AI')).toHaveStyle({ width: '2.75rem', height: '2.75rem' });
  });

  it('accepts a custom size', () => {
    const { getByText } = renderWithTheme(<GradientIconWrapper size="4rem">AI</GradientIconWrapper>);
    expect(getByText('AI')).toHaveStyle({ width: '4rem', height: '4rem' });
  });
});
