import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { AnimatedLoadingText } from '.';

describe('AnimatedLoadingText', () => {
  it('renders one child span per character, inside the Typography root span', () => {
    const { container } = renderWithTheme(<AnimatedLoadingText text="Hi" />);
    // `bodyMedium` is a custom variant with no variantMapping, so the
    // Typography root itself is also a <span> — 1 root + 1 per character.
    expect(container.querySelectorAll('span').length).toBe(3);
    // Structural query, not an internal MUI Typography class-name selector
    // (R-T6 bans those outside shared/brand/mui-overrides/, tests included):
    // the component renders exactly one root element, so it is the render
    // container's first (and only) element child.
    const root = container.firstElementChild;
    expect(root?.children.length).toBe(2);
  });

  it('renders a non-breaking space (U+00A0) for literal spaces', () => {
    const { container } = renderWithTheme(<AnimatedLoadingText text="a b" />);
    const root = container.firstElementChild;
    const charSpans = root ? Array.from(root.children) : [];
    expect(charSpans).toHaveLength(3);
    // Compared by code point, not by string literal — a plain U+0020 and a
    // U+00A0 non-breaking space are visually indistinguishable in source.
    expect(charSpans[1]?.textContent?.charCodeAt(0)).toBe(160);
    expect(charSpans[1]?.textContent).toBe(String.fromCharCode(160));
  });
});
