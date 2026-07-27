import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import en from './en.json';
import { I18nProvider } from './I18nProvider';
import { i18n } from './i18n';
import { t } from './t';
import type { TFunction } from './t';

/**
 * Stand-in for a `shared/ui` component call site. As of this unit landing,
 * no `shared/ui` component calls `t()` with a real key yet — unit S1 has
 * only landed the interim always-fallback stub and its type
 * (`src/shared/ui/lib/t.ts`); see `./README.md`, "Current bundle state".
 * This fixture uses the exact published contract
 * (`TFunction = (key, fallback) => string`) so the proof below is
 * call-shape-identical to what a real Wave-2 component will do, not a
 * simplified substitute.
 */
function Greeting({ translate }: { translate: TFunction }) {
  return <p>{translate('demo.greeting', 'Hello (fallback, should not render)')}</p>;
}

describe('I18nProvider', () => {
  afterEach(() => {
    i18n.removeResourceBundle('en', 'translation');
    i18n.addResourceBundle('en', 'translation', en, true, true);
  });

  it('renders children unchanged when nothing needs translating', () => {
    render(
      <I18nProvider>
        <button type="button">child content</button>
      </I18nProvider>,
    );
    expect(screen.getByRole('button').textContent).toBe('child content');
  });

  it('GREEN: an S1-shaped component resolves a real bundle key end-to-end through I18nProvider + t()', () => {
    i18n.addResourceBundle('en', 'translation', { 'demo.greeting': 'Hello from en.json' }, true, true);

    render(
      <I18nProvider>
        <Greeting translate={t} />
      </I18nProvider>,
    );

    expect(screen.getByText('Hello from en.json').textContent).toBe('Hello from en.json');
  });

  it('falls back gracefully through the same provider when the key is missing (paired RED case)', () => {
    render(
      <I18nProvider>
        <Greeting translate={t} />
      </I18nProvider>,
    );

    expect(screen.getByText('Hello (fallback, should not render)').textContent).toBe(
      'Hello (fallback, should not render)',
    );
  });
});
