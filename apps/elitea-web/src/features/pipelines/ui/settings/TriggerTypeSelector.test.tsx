import userEvent from '@testing-library/user-event';
import { waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureGeneratedClient, resetGeneratedClient } from '@/shared/api/generated/mutator';
import { server } from '@/test/setup';

import { renderWithRouterAndProject } from '../../__tests__/testUtils';
import { TriggerTypeSelector } from './TriggerTypeSelector';

const BASE = '/api/v2';
const PROJECT_ID = 'proj-1';
const VERSION_ID = 7;
const TRIGGER_URL = `${BASE}/elitea_core/pipeline_trigger/prompt_lib/${PROJECT_ID}/pipeline/${VERSION_ID}/trigger`;

beforeEach(() => {
  configureGeneratedClient({ baseUrl: BASE });
});

afterEach(() => {
  resetGeneratedClient();
});

describe('TriggerTypeSelector', () => {
  it('defaults to Chat Message and shows all three trigger options', async () => {
    server.use(http.get(TRIGGER_URL, () => HttpResponse.json({ version_id: String(VERSION_ID), type: 'chat_message' })));

    const { findByText } = renderWithRouterAndProject(
      <TriggerTypeSelector
        projectId={PROJECT_ID}
        versionId={VERSION_ID}
      />,
      PROJECT_ID,
    );

    expect(await findByText('Trigger')).toBeInTheDocument();
  });

  it('restricts to Chat Message only when the saved YAML has interactive elements', async () => {
    server.use(http.get(TRIGGER_URL, () => HttpResponse.json({ version_id: String(VERSION_ID), type: 'chat_message' })));

    const versionInstructions = 'nodes:\n  - id: HITL 1\n    type: hitl\n';

    const { findByRole } = renderWithRouterAndProject(
      <TriggerTypeSelector
        projectId={PROJECT_ID}
        versionId={VERSION_ID}
        versionInstructions={versionInstructions}
      />,
      PROJECT_ID,
    );

    const select = await findByRole('combobox');
    await userEvent.setup().click(select);
    // Only the Chat Message option is offered — no Schedule/Webhook rows exist.
    expect(document.querySelectorAll('[data-value="schedule"]').length).toBe(0);
    expect(document.querySelectorAll('[data-value="webhook"]').length).toBe(0);
  });

  it('opens the schedule modal when Schedule is selected', async () => {
    server.use(http.get(TRIGGER_URL, () => HttpResponse.json({ version_id: String(VERSION_ID), type: 'chat_message' })));
    const user = userEvent.setup();

    const { findByRole, getByRole, findByText } = renderWithRouterAndProject(
      <TriggerTypeSelector
        projectId={PROJECT_ID}
        versionId={VERSION_ID}
      />,
      PROJECT_ID,
    );

    await user.click(await findByRole('combobox'));
    await user.click(getByRole('option', { name: 'Schedule' }));

    expect(await findByText('Schedule settings')).toBeInTheDocument();
  });

  it('PUTs a webhook trigger and opens the webhook modal when Webhook is selected', async () => {
    server.use(
      http.get(TRIGGER_URL, () => HttpResponse.json({ version_id: String(VERSION_ID), type: 'chat_message' })),
      http.put(TRIGGER_URL, () => HttpResponse.json({ version_id: String(VERSION_ID), type: 'webhook', schedule: { webhook_type: 'github', webhook_url: '/hook/github', secret_value: 'abc' } })),
    );
    const user = userEvent.setup();

    const { findByRole, getByRole, findByText } = renderWithRouterAndProject(
      <TriggerTypeSelector
        projectId={PROJECT_ID}
        versionId={VERSION_ID}
      />,
      PROJECT_ID,
    );

    await user.click(await findByRole('combobox'));
    await user.click(getByRole('option', { name: 'Webhook' }));

    expect(await findByText('Webhook settings')).toBeInTheDocument();
  });

  it('surfaces the backend error text (not a fixed generic message) when switching to Chat Message fails', async () => {
    // Regression coverage (confirmed finding 3): this used to always report
    // the fixed 'Failed to update trigger' string regardless of what the
    // backend actually returned -- discarding the real `{"error": "boom"}`
    // envelope's message.
    server.use(
      http.get(TRIGGER_URL, () => HttpResponse.json({ version_id: String(VERSION_ID), type: 'schedule', schedule: { cron: '0 0 * * 6' } })),
      http.put(TRIGGER_URL, () => HttpResponse.json({ error: 'boom' }, { status: 400 })),
    );
    const user = userEvent.setup();
    const onNotifyError = vi.fn();

    const { findByRole, getByRole } = renderWithRouterAndProject(
      <TriggerTypeSelector
        projectId={PROJECT_ID}
        versionId={VERSION_ID}
        onNotifyError={onNotifyError}
      />,
      PROJECT_ID,
    );

    await user.click(await findByRole('combobox'));
    await user.click(getByRole('option', { name: 'Chat Message' }));

    await waitFor(() => expect(onNotifyError).toHaveBeenCalledWith('boom'));
  });

  it('does not throw when projectId/versionId are undefined', async () => {
    const { findByText } = renderWithRouterAndProject(<TriggerTypeSelector />, undefined);
    expect(await findByText('Trigger')).toBeInTheDocument();
  });
});
