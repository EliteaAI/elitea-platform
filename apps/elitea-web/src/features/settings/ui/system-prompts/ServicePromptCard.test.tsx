/**
 * Interpolation coverage for issue #45's stub migration.
 *
 * Before #45 this file imported `t` from the always-return-the-fallback stub
 * `shared/ui/lib/t.ts`, so a JS template-literal fallback
 * (`` `Edit service prompt ${item.key}` ``) rendered the interpolated text.
 * After the migration `t` resolves against `en.json`, whose value for these
 * two keys is `"Edit service prompt {{key}}"` / `"Restore prompt {{key}} to
 * default"` — the bundle wins, so the call site MUST pass the matching
 * options object or the accessible name renders the literal `{{key}}`.
 *
 * These two aria-labels had no test at all, so the migration's regression was
 * invisible here (unlike `shared/ui/cron/describe.ts`, whose own suite fails
 * loudly on the same mistake). Asserting on the ACCESSIBLE NAME rather than a
 * `t()` call keeps the check meaningful whatever the key/bundle text becomes.
 */
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { ServicePromptCard } from './ServicePromptCard';

const item = { id: 1, key: 'chat_summary', label: 'Chat summary', prompt: 'Summarise the chat.' };

function renderCard(overrides: { hasDefault?: boolean } = {}) {
  return renderWithTheme(
    <ServicePromptCard
      item={item}
      hasDefault={overrides.hasDefault ?? true}
      isBusy={false}
      canEdit
      onEdit={vi.fn()}
      onRestore={vi.fn()}
    />,
  );
}

describe('ServicePromptCard interpolated aria-labels', () => {
  it('names the edit button with the prompt key substituted, not a literal {{key}}', () => {
    renderCard();
    expect(screen.getByRole('button', { name: 'Edit service prompt chat_summary' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /\{\{key\}\}/ })).toBeNull();
  });

  it('names the restore button with the prompt key substituted, not a literal {{key}}', () => {
    renderCard();
    expect(screen.getByRole('button', { name: 'Restore prompt chat_summary to default' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /\{\{key\}\}/ })).toBeNull();
  });
});
