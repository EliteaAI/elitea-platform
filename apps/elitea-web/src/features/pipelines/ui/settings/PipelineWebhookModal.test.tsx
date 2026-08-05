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

  it('toggling "Show secret" then "Hide secret" masks it again', async () => {
    const user = userEvent.setup();
    const { getByRole, getByDisplayValue, queryByDisplayValue } = renderWithTheme(
      <PipelineWebhookModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        webhookType="github"
        secretValue="topsecret123"
      />,
    );

    await user.click(getByRole('button', { name: 'Show secret' }));
    expect(getByDisplayValue('topsecret123')).toBeInTheDocument();

    await user.click(getByRole('button', { name: 'Hide secret' }));
    expect(queryByDisplayValue('topsecret123')).not.toBeInTheDocument();
  });

  it('copies the secret to the clipboard and notifies via onNotify', async () => {
    const user = userEvent.setup();
    const onNotify = vi.fn();
    const { getByRole } = renderWithTheme(
      <PipelineWebhookModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        webhookType="github"
        secretValue="topsecret123"
        onNotify={onNotify}
      />,
    );

    await user.click(getByRole('button', { name: 'Copy secret' }));
    expect(await navigator.clipboard.readText()).toBe('topsecret123');
    expect(onNotify).toHaveBeenCalledWith('Secret copied to clipboard');
  });

  it('copies the example request to the clipboard', async () => {
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

    await user.click(getByRole('button', { name: 'Copy example' }));
    const copied = await navigator.clipboard.readText();
    expect(copied).toContain('X-Hub-Signature-256');
  });

  it('renders a GitLab-flavoured example request with the X-Gitlab-Token header', () => {
    const { getByText } = renderWithTheme(
      <PipelineWebhookModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        webhookType="gitlab"
        webhookUrl="/elitea_core/pipeline_trigger/prompt_lib/proj-1/pipeline/1/webhook/gitlab"
        secretValue="gl-secret"
      />,
    );
    expect(getByText(/X-Gitlab-Token/)).toBeInTheDocument();
  });

  it('renders a Custom-flavoured example request using the given secretHeader, falling back to X-Webhook-Token when none is given', () => {
    const { getByText, rerender } = renderWithTheme(
      <PipelineWebhookModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        webhookType="custom"
        webhookUrl="/elitea_core/pipeline_trigger/prompt_lib/proj-1/pipeline/1/webhook/custom"
        secretValue="cust-secret"
        secretHeader="X-My-Custom-Header"
      />,
    );
    expect(getByText(/X-My-Custom-Header/)).toBeInTheDocument();

    rerender(
      <PipelineWebhookModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        webhookType="custom"
        webhookUrl="/elitea_core/pipeline_trigger/prompt_lib/proj-1/pipeline/1/webhook/custom"
        secretValue="cust-secret"
      />,
    );
    // The description line and the example request curl command both mention
    // "X-Webhook-Token" once the header falls back to its default -- confirm at least one occurrence.
    expect(document.body.textContent).toContain('X-Webhook-Token');
  });

  it('renders no example section at all when there is no webhookUrl', () => {
    const { queryByText } = renderWithTheme(
      <PipelineWebhookModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        webhookType="github"
      />,
    );
    expect(queryByText('Example Request')).not.toBeInTheDocument();
  });

  it('masks the secret substring inside secretInstructions until "Show secret" is clicked', async () => {
    const user = userEvent.setup();
    const { getByText, queryByText, getByRole } = renderWithTheme(
      <PipelineWebhookModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        webhookType="github"
        secretValue="topsecret123"
        secretInstructions="Use header value: topsecret123 in your request"
      />,
    );

    expect(queryByText(/Use header value: topsecret123/)).not.toBeInTheDocument();
    expect(getByText(/Use header value: •+ in your request/)).toBeInTheDocument();

    await user.click(getByRole('button', { name: 'Show secret' }));
    expect(getByText('Use header value: topsecret123 in your request')).toBeInTheDocument();
  });

  it('shows the "(new - click Apply to save)" pending marker instead of secretInstructions once a new secret has been regenerated', async () => {
    const user = userEvent.setup();
    const { getByRole, queryByText, getByText } = renderWithTheme(
      <PipelineWebhookModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        webhookType="github"
        secretValue="topsecret123"
        secretInstructions="Use header value: topsecret123 in your request"
      />,
    );

    await user.click(getByRole('button', { name: 'Regenerate secret' }));
    expect(getByText(/new - click Apply to save/)).toBeInTheDocument();
    expect(queryByText(/Use header value:/)).not.toBeInTheDocument();
  });

  it('passes isLoading through to the confirm button\'s confirming state', () => {
    const { getByRole } = renderWithTheme(
      <PipelineWebhookModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        webhookType="github"
        isLoading
      />,
    );
    expect(getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('resets pending secret and revealed state (but not webhook type) when reopened without a webhookType override', async () => {
    const user = userEvent.setup();
    const { getByRole, rerender, getByText, queryByText } = renderWithTheme(
      <PipelineWebhookModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        webhookType="github"
        secretValue="topsecret123"
      />,
    );

    await user.click(getByRole('button', { name: 'Show secret' }));
    await user.click(getByRole('button', { name: 'Regenerate secret' }));
    expect(getByText(/new - click Apply to save/)).toBeInTheDocument();

    // Close then reopen -- the effect should clear the pending secret and re-hide it.
    rerender(
      <PipelineWebhookModal
        open={false}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        webhookType="github"
        secretValue="topsecret123"
      />,
    );
    rerender(
      <PipelineWebhookModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        webhookType="github"
        secretValue="topsecret123"
      />,
    );

    expect(queryByText(/new - click Apply to save/)).not.toBeInTheDocument();
    expect(() => getByRole('button', { name: 'Hide secret' })).toThrow();
  });

  it('does not throw when onNotify is not supplied and a copy/regenerate action fires', async () => {
    const user = userEvent.setup();
    const { getByRole } = renderWithTheme(
      <PipelineWebhookModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        webhookType="github"
        secretValue="topsecret123"
      />,
    );
    await expect(user.click(getByRole('button', { name: 'Regenerate secret' }))).resolves.toBeUndefined();
    await expect(user.click(getByRole('button', { name: 'Copy secret' }))).resolves.toBeUndefined();
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
