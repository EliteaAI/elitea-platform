import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { EntityIcon } from './EntityIcon';

describe('EntityIcon', () => {
  it('renders an image when icon.url is given and no component', () => {
    const { getByTestId } = renderWithTheme(
      <EntityIcon
        icon={{ url: 'https://example.com/icon.png' }}
        entityType="toolkit"
      />,
    );
    const img = getByTestId('entity-icon');
    expect(img.tagName).toBe('IMG');
    expect(img).toHaveAttribute('src', 'https://example.com/icon.png');
  });

  it('renders icon.component (inside the gradient frame) when given, even alongside a url', () => {
    const { getByTestId, getByText } = renderWithTheme(
      <EntityIcon
        icon={{ component: <span>C</span>, url: 'https://example.com/icon.png' }}
        entityType="toolkit"
      />,
    );
    expect(getByText('C')).toBeInTheDocument();
    expect(getByTestId('entity-icon').tagName).not.toBe('IMG');
  });

  it('falls back to the agent glyph when neither component nor url is given', () => {
    const { container } = renderWithTheme(
      <EntityIcon
        icon={undefined}
        entityType="agent"
      />,
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('falls back to the pipeline glyph', () => {
    const { container } = renderWithTheme(
      <EntityIcon
        icon={undefined}
        entityType="pipeline"
      />,
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('falls back to the toolkit glyph', () => {
    const { container } = renderWithTheme(
      <EntityIcon
        icon={undefined}
        entityType="toolkit"
      />,
    );
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
