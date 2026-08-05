import { describe, expect, it } from 'vitest';

import type { Theme } from '@mui/material/styles';

import { DEFAULT_BRAND_PACK, buildEliteaTheme } from '@/shared/brand';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { cardSx, ResourceCard } from './ResourceCard';

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

/** Resolves a (possibly theme-callback) sx field value against the real theme, the way MUI's `sx` prop would. */
function resolve(value: unknown): unknown {
  return typeof value === 'function' ? (value as (t: Theme) => unknown)(theme) : value;
}

describe('cardSx', () => {
  it('resolves a distinct background per colorScheme, matching that scheme\'s own token (finding #1)', () => {
    const blue = cardSx('blue');
    const orange = cardSx('orange');

    expect(resolve(blue.background)).toBe(theme.vars.palette.background.resourceCard.blue.card);
    expect(resolve(orange.background)).toBe(theme.vars.palette.background.resourceCard.orange.card);
    // The whole point of the bug: every scheme must NOT collapse onto the
    // same generic gradient.
    expect(resolve(blue.background)).not.toBe(resolve(orange.background));
  });

  it('resolves a distinct ::before border-gradient per colorScheme (finding #1)', () => {
    const purple = cardSx('purple');
    const green = cardSx('green');
    const purpleBefore = purple['&::before'];
    const greenBefore = green['&::before'];

    expect(resolve(purpleBefore.background)).toBe(theme.vars.palette.background.resourceCard.purple.borderGradient);
    expect(resolve(greenBefore.background)).toBe(theme.vars.palette.background.resourceCard.green.borderGradient);
    expect(resolve(purpleBefore.background)).not.toBe(resolve(greenBefore.background));
  });

  it('covers every declared color scheme with a real token (no scheme silently falls back)', () => {
    // `theme.vars.palette.background.resourceCard[scheme].card` (a computed
    // index) is unscannable by §4.6 check 7's reference scan (it requires a
    // fully static dotted path — see `reference-scan.ts`'s own doc comment)
    // and was previously misclassified as a phantom reference to the
    // intermediate `background.resourceCard` node, which has no CSS var of
    // its own. Each scheme's token is instead read through its own static
    // path once, outside the loop.
    const expectedCardByScheme = {
      blue: theme.vars.palette.background.resourceCard.blue.card,
      orange: theme.vars.palette.background.resourceCard.orange.card,
      purple: theme.vars.palette.background.resourceCard.purple.card,
      green: theme.vars.palette.background.resourceCard.green.card,
      pink: theme.vars.palette.background.resourceCard.pink.card,
    } as const;
    (['blue', 'orange', 'purple', 'green', 'pink'] as const).forEach(scheme => {
      const sx = cardSx(scheme);
      expect(resolve(sx.background)).toBe(expectedCardByScheme[scheme]);
    });
  });

  it('has no hover style block — resource cards are static, non-clickable panels (finding #4)', () => {
    const sx = cardSx('blue');
    expect(sx).not.toHaveProperty('&:hover');
    expect(JSON.stringify(Object.keys(sx))).not.toContain('hover');
  });
});

describe('ResourceCard', () => {
  it('renders title, description, and children for a given colorScheme without crashing', () => {
    const { getByText } = renderWithTheme(
      <ResourceCard
        title="Documentation"
        description="API reference, guides, and platform concepts"
        colorScheme="blue"
        tourTargetId="doc-card"
        icon={<span>icon</span>}
      >
        <span>No links configured</span>
      </ResourceCard>,
    );

    expect(getByText('Documentation')).toBeInTheDocument();
    expect(getByText('API reference, guides, and platform concepts')).toBeInTheDocument();
    expect(getByText('No links configured')).toBeInTheDocument();
  });
});
