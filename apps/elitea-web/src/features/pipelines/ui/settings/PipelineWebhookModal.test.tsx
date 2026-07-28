import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { PipelineWebhookModal } from './PipelineWebhookModal';

/**
 * `userEvent.setup()` unconditionally installs its own `navigator.clipboard`
 * stub -- reading the copied text back via that same stub's `readText()` is
 * the reliable proof, matching `shared/ui/CopyToClipboardButton.test.tsx`'s
 * own established convention (its doc comment explains why a bespoke mock
 * would be silently clobbered).
 */
describe('PipelineWebhookModal', () => {
  it('is not rendered when closed', () => {
    const { queryByText } = renderWithTheme(
      <PipelineWebhookModal
        open={false}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(queryByText('Webhook settings')).not.toBeInTheDocument();
  });

  it('shows the webhook type description and the GitHub example request', () => {
    const { getByText } = renderWithTheme(
      <PipelineWebhookModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        webhookType="github"
        webhookUrl="/elitea_core/pipeline_trigger/prompt_lib/proj-1/pipeline/1/webhook/github"
      />,
    );
    expect(getByText('Uses x-hub-signature-256 header with HMAC-SHA256 signature')).toBeInTheDocument();
    expect(getByText('Example Request')).toBeInTheDocument();
  });

  it('does not render a Secret Value section when no secret exists yet', () => {
    const { queryByText } = renderWithTheme(
      <PipelineWebhookModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        webhookType="github"
      />,
    );
    expect(queryByText(/Secret Value/)).not.toBeInTheDocument();
  });

  it('masks the secret by default and reveals it on toggle', async () => {
    const user = userEvent.setup();
    const { getByText, getByDisplayValue, getByRole } = renderWithTheme(
      <PipelineWebhookModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        webhookType="github"
        secretValue="topsecret123"
      />,
    );

    expect(getByText(/Secret Value/)).toBeInTheDocument();
    expect(() => getByDisplayValue('topsecret123')).toThrow();

    await user.click(getByRole('button', { name: 'Show secret' }));
    expect(getByDisplayValue('topsecret123')).toBeInTheDocument();
  });

  it('copies the webhook URL to the clipboard', async () => {
    const user = userEvent.setup();
    const { getByRole } = renderWithTheme(
      <PipelineWebhookModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        webhookType="github"
        webhookUrl="/elitea_core/pipeline_trigger/prompt_lib/proj-1/pipeline/1/webhook/github"
      />,
    );

    await user.click(getByRole('button', { name: 'Copy URL' }));
    expect(await navigator.clipboard.readText()).toBe(`${window.location.origin}/elitea_core/pipeline_trigger/prompt_lib/proj-1/pipeline/1/webhook/github`);
  });

  it('generates a pending new secret on Regenerate, submitted on Apply', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn<(webhookType: string, newSecretValue: string | null) => void>();
    const onClose = vi.fn();
    const { getByRole, getByText } = renderWithTheme(
      <PipelineWebhookModal
        open
        onClose={onClose}
        onSubmit={onSubmit}
        webhookType="github"
        secretValue="oldsecret"
      />,
    );

    await user.click(getByRole('button', { name: 'Regenerate secret' }));
    expect(getByText(/new - click Apply to save/)).toBeInTheDocument();

    await user.click(getByRole('button', { name: 'Apply' }));
    expect(onSubmit).toHaveBeenCalledWith('github', expect.any(String));
    const [, newSecretValue] = onSubmit.mock.calls[0] ?? [];
    expect(typeof newSecretValue === 'string' && newSecretValue.length > 0).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });

  it('submits with a null secret when nothing was regenerated', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { getByRole } = renderWithTheme(
      <PipelineWebhookModal
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
        webhookType="gitlab"
      />,
    );

    await user.click(getByRole('button', { name: 'Apply' }));
    expect(onSubmit).toHaveBeenCalledWith('gitlab', null);
  });

  it('switches webhook type via the radio group', async () => {
    const user = userEvent.setup();
    const { getByLabelText, getByText } = renderWithTheme(
      <PipelineWebhookModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        webhookType="github"
      />,
    );

    await user.click(getByLabelText('Custom'));
    expect(getByText('Uses X-Webhook-Token header with secret token')).toBeInTheDocument();
  });
});
