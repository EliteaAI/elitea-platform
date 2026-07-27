import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MissingEnvPage, type RequiredConfigKey } from '../index';

/**
 * Behavioural-parity tests for MissingEnvPage against the old
 * apps/elitea-ui/src/pages/EnvMissingPage.jsx: the "[Error]" marker, the
 * " System env missing: " sentence, and one list item per missing variable
 * under its UPPER_CASE env name. Assertions are role/text semantics only —
 * no markup snapshots.
 *
 * The copy assertions compare raw textContent, NOT normalised text: parity
 * item COPY-468 requires the baseline strings verbatim, and the baseline's
 * `<p> System env missing: </p>` carries a leading and a trailing space that
 * RTL's default whitespace normalisation would hide.
 */
describe('MissingEnvPage', () => {
  it('renders the full missing trio as an accessible list in order', () => {
    const missing: readonly RequiredConfigKey[] = [
      'vite_server_url',
      'vite_base_uri',
      'vite_public_project_id',
    ];
    render(<MissingEnvPage missing={missing} />);

    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('[Error]');
    // COPY-468: byte-exact baseline copy, spaces included (EnvMissingPage.jsx:17).
    expect(
      screen.getByText('System env missing:', { exact: false }).textContent,
    ).toBe(' System env missing: ');

    const list = screen.getByRole('list');
    const items = within(list).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'VITE_SERVER_URL',
      'VITE_BASE_URI',
      'VITE_PUBLIC_PROJECT_ID',
    ]);
  });

  it('renders a single missing variable', () => {
    render(<MissingEnvPage missing={['vite_base_uri']} />);

    const items = screen.getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['VITE_BASE_URI']);
  });
});
