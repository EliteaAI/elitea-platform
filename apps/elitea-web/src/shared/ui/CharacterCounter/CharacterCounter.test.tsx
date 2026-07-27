import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { CharacterCounter } from '.';

describe('CharacterCounter', () => {
  it('shows the remaining character count', () => {
    const { getByText } = renderWithTheme(<CharacterCounter value="abc" maxLength={10} />);
    expect(getByText('7 characters left')).toBeInTheDocument();
  });

  it('appends the limit-reached message at zero remaining', () => {
    const { getByText } = renderWithTheme(<CharacterCounter value="abcde" maxLength={5} />);
    expect(getByText(/0 characters left/)).toBeInTheDocument();
    expect(getByText(/MAXIMUM character limit/)).toBeInTheDocument();
  });

  it('does not append the limit-reached message before the limit', () => {
    const { queryByText } = renderWithTheme(<CharacterCounter value="abc" maxLength={10} />);
    expect(queryByText(/MAXIMUM character limit/)).not.toBeInTheDocument();
  });

  it('forwards data-testid', () => {
    const { getByTestId } = renderWithTheme(
      <CharacterCounter value="abc" maxLength={10} data-testid="counter" />,
    );
    expect(getByTestId('counter')).toBeInTheDocument();
  });
});
