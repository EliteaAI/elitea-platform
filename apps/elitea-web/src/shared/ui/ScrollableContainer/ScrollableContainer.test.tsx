import { createRef } from 'react';
import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { ScrollableContainer, type SimpleBarInstance } from '.';

describe('ScrollableContainer', () => {
  it('renders its children', () => {
    const { getByText } = renderWithTheme(
      <ScrollableContainer>
        <div>scrollable content</div>
      </ScrollableContainer>,
    );
    expect(getByText('scrollable content')).toBeInTheDocument();
  });

  it('forwards a caller sx override alongside its own scrollbar styling', () => {
    const { container } = renderWithTheme(
      <ScrollableContainer sx={{ opacity: 0.5 }}>content</ScrollableContainer>,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper).not.toBeNull();
    expect(wrapper).toHaveStyle({ opacity: '0.5' });
  });

  it('renders the SimpleBar content wrapper (so the custom scrollbar chrome mounts, not the browser default)', () => {
    const { container } = renderWithTheme(
      <ScrollableContainer>
        <div>content</div>
      </ScrollableContainer>,
    );
    expect(container.querySelector('.simplebar-content-wrapper')).not.toBeNull();
    expect(container.querySelector('.simplebar-track.simplebar-vertical')).not.toBeNull();
  });

  it('sizes to fill the container by default, and to its content when fillContainer is false', () => {
    const { container: filled } = renderWithTheme(
      <ScrollableContainer>
        <div>content</div>
      </ScrollableContainer>,
    );
    const filledRoot = filled.querySelector('[data-simplebar]') as HTMLElement | null;
    expect(filledRoot).toHaveStyle({ height: '100%' });

    const { container: fitted } = renderWithTheme(
      <ScrollableContainer fillContainer={false}>
        <div>content</div>
      </ScrollableContainer>,
    );
    const fittedRoot = fitted.querySelector('[data-simplebar]') as HTMLElement | null;
    expect(fittedRoot).toHaveStyle({ height: 'auto' });
  });

  it('forwards ref to the underlying SimpleBar instance', () => {
    const ref = createRef<SimpleBarInstance>();
    renderWithTheme(
      <ScrollableContainer ref={ref}>
        <div>content</div>
      </ScrollableContainer>,
    );
    expect(ref.current).not.toBeNull();
    expect(typeof ref.current?.getScrollElement).toBe('function');
  });
});
