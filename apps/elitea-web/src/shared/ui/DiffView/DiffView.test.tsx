import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { lineDiff } from '@/shared/lib/lineDiff';

import { DiffView } from './DiffView';

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function show(before: string, after: string) {
  return render(
    <ThemeProvider theme={theme} defaultMode={DEFAULT_COLOR_SCHEME}>
      <DiffView parts={lineDiff(before, after)} data-testid="diff" />
    </ThemeProvider>,
  );
}

describe('DiffView', () => {
  it('marks added and removed lines with TEXT, not only colour', () => {
    show('graph TD\nA-->B', 'graph TD\nA-->C');
    const diff = screen.getByTestId('diff');
    const kinds = [...diff.querySelectorAll('[data-diff-kind]')].map((el) => [
      el.getAttribute('data-diff-kind'),
      el.textContent?.trim(),
    ]);
    expect(kinds).toEqual([
      ['unchanged', 'graph TD'],
      ['removed', '- A-->B'],
      ['added', '+ A-->C'],
    ]);
  });

  it('renders an unchanged document as unchanged lines only', () => {
    show('a\nb', 'a\nb');
    const kinds = new Set(
      [...screen.getByTestId('diff').querySelectorAll('[data-diff-kind]')].map((el) =>
        el.getAttribute('data-diff-kind'),
      ),
    );
    expect(kinds).toEqual(new Set(['unchanged']));
  });

  it('renders nothing for two empty documents', () => {
    show('', '');
    expect(screen.getByTestId('diff').querySelectorAll('[data-diff-kind]')).toHaveLength(0);
  });
});
