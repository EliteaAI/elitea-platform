/**
 * The two behaviours of the persona section that a reader cannot infer from
 * the markup, and that a "does it render" test would pass without:
 *
 *  1. instructions are stored PER PERSONA (`personality_instructions.<persona>`),
 *     so the single text field is a window onto a map — typing must land in
 *     the selected persona's slot and nowhere else, and switching persona must
 *     swap the visible text rather than carry it across;
 *  2. the `none` persona has no personality overlay, so it has no instructions
 *     field at all.
 *
 * A flat `default_instructions` field (what the sibling Personalization page
 * still uses) would render identically and pass any smoke test — these
 * assertions are what separates the two models.
 */
import type { ReactElement } from 'react';

import { Formik } from 'formik';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { AIPersonalityPersonalization } from './AIPersonalityPersonalization';
import { serializeSettingsProfile, type SettingsProfileFormValues } from './settingsProfileForm';

const INSTRUCTIONS_LABEL = 'User instructions';

function renderSection(overrides: Partial<SettingsProfileFormValues> = {}): {
  latest: () => SettingsProfileFormValues;
} {
  let current: SettingsProfileFormValues = { ...serializeSettingsProfile(undefined), ...overrides };
  renderWithTheme(
    (
      <Formik<SettingsProfileFormValues>
        initialValues={current}
        onSubmit={() => undefined}
      >
        {({ values }) => {
          current = values;
          return <AIPersonalityPersonalization />;
        }}
      </Formik>
    ) as ReactElement,
  );
  return { latest: () => current };
}

describe('AIPersonalityPersonalization — per-persona instructions', () => {
  it('writes typed text into the SELECTED persona slot and leaves the others empty', async () => {
    const user = userEvent.setup();
    const { latest } = renderSection({ persona: 'qa' });

    await user.type(screen.getByLabelText(INSTRUCTIONS_LABEL), 'be terse');

    const stored = latest().personality_instructions;
    expect(stored.qa).toBe('be terse');
    expect(stored.generic).toBe('');
    expect(stored.nerdy).toBe('');
  });

  it('swaps the visible text when the persona changes, instead of carrying it across', async () => {
    const user = userEvent.setup();
    renderSection({
      persona: 'generic',
      personality_instructions: {
        generic: 'generic text',
        qa: '',
        nerdy: 'nerdy text',
        quirky: '',
        cynical: '',
        none: '',
        bare: '',
      },
    });

    expect(screen.getByLabelText(INSTRUCTIONS_LABEL)).toHaveValue('generic text');

    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByTestId('select-option-nerdy'));

    expect(screen.getByLabelText(INSTRUCTIONS_LABEL)).toHaveValue('nerdy text');
  });

  it('shows the persona-specific placeholder for a persona with no instructions yet', () => {
    renderSection({ persona: 'cynical' });

    expect(screen.getByLabelText(INSTRUCTIONS_LABEL)).toHaveAttribute(
      'placeholder',
      'No custom instructions for the Cynical persona yet. Type here to add some.',
    );
  });

  it('hides the instructions field entirely for the `none` persona', () => {
    renderSection({ persona: 'none' });

    expect(screen.queryByLabelText(INSTRUCTIONS_LABEL)).not.toBeInTheDocument();
  });

  it('renders each persona option with its description, not the label alone', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole('combobox'));

    expect(screen.getByText('Precise, technical, testing-focused')).toBeInTheDocument();
  });
});
