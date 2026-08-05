import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { DetailHeader } from './DetailHeader';

describe('DetailHeader', () => {
  it('renders the entity name', () => {
    const { getByText } = renderWithTheme(
      <DetailHeader
        entityName="My Agent"
        onBack={() => {}}
      />,
    );
    expect(getByText('My Agent')).toBeInTheDocument();
  });

  it('renders an empty heading gracefully when entityName is empty (the real stub response today)', () => {
    const { getByRole } = renderWithTheme(
      <DetailHeader
        entityName=""
        onBack={() => {}}
      />,
    );
    expect(getByRole('button')).toBeInTheDocument();
  });

  it('calls onBack when the back button is clicked', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const { getByRole } = renderWithTheme(
      <DetailHeader
        entityName="My Agent"
        onBack={onBack}
      />,
    );
    await user.click(getByRole('button'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
