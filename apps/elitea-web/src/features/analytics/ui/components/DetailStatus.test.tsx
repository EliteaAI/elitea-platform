import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { DetailEmpty, DetailLoading } from './DetailStatus';

describe('DetailLoading', () => {
  it('renders a progress indicator', () => {
    const { getByRole } = renderWithTheme(<DetailLoading />);
    expect(getByRole('progressbar')).toBeInTheDocument();
  });
});

describe('DetailEmpty', () => {
  it('renders the "no data found" message', () => {
    const { getByText } = renderWithTheme(<DetailEmpty />);
    expect(getByText('No data found.')).toBeInTheDocument();
  });
});
