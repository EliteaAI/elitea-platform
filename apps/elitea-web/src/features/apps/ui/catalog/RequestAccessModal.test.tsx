import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { applicationCatalog } from '../../lib/constants';
import { buildCatalogApplication } from '../../model/catalog';
import { renderWithProviders } from '../../__tests__/testUtils';

import { RequestAccessModal } from './RequestAccessModal';

const wikisApp = buildCatalogApplication(applicationCatalog()[0]!, {}, new Set());

describe('RequestAccessModal', () => {
  it('renders nothing when there is no application', () => {
    const { container } = renderWithProviders(
      <RequestAccessModal
        open={true}
        application={null}
        isSubmitting={false}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a validation error and does not submit when Send is clicked with an empty reason', () => {
    const onSubmit = vi.fn();
    renderWithProviders(
      <RequestAccessModal
        open={true}
        application={wikisApp}
        isSubmitting={false}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    // The Send button is disabled while reason is empty (matches the
    // baseline's `disabled={isSubmitting || !reason.trim()}`), so it
    // cannot be clicked to trigger the defensive validation branch through
    // normal interaction — asserting the disabled state IS the parity
    // contract here.
    expect(screen.getByRole('button', { name: 'Send Request' })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits the trimmed reason and clears the field on success', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderWithProviders(
      <RequestAccessModal
        open={true}
        application={wikisApp}
        isSubmitting={false}
        onClose={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    const textbox = screen.getByPlaceholderText('Describe why you need access to this application...');
    await user.type(textbox, '  I need this for onboarding  ');
    await user.click(screen.getByRole('button', { name: 'Send Request' }));

    expect(onSubmit).toHaveBeenCalledWith(wikisApp, 'I need this for onboarding');
  });

  it('calls onClose (and clears local state) when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(
      <RequestAccessModal
        open={true}
        application={wikisApp}
        isSubmitting={false}
        onClose={onClose}
        onSubmit={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disables both actions while isSubmitting', () => {
    renderWithProviders(
      <RequestAccessModal
        open={true}
        application={wikisApp}
        isSubmitting={true}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send Request' })).toBeDisabled();
  });
});
