import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { PipelineScheduleModal } from './PipelineScheduleModal';

describe('PipelineScheduleModal', () => {
  it('is not rendered when closed', () => {
    const { queryByText } = renderWithTheme(
      <PipelineScheduleModal
        open={false}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(queryByText('Schedule settings')).not.toBeInTheDocument();
  });

  it('seeds the field from the cron prop when opened', () => {
    const { getByText } = renderWithTheme(
      <PipelineScheduleModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        cron="0 0 * * 6"
      />,
    );
    expect(getByText('Schedule settings')).toBeInTheDocument();
    expect(getByText('At 00:00, only on Saturday')).toBeInTheDocument();
  });

  it('submits the current cron expression and closes on Apply', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onClose = vi.fn();

    const { getByRole } = renderWithTheme(
      <PipelineScheduleModal
        open
        onClose={onClose}
        onSubmit={onSubmit}
        cron="0 0 * * 6"
      />,
    );

    await user.click(getByRole('button', { name: 'Apply' }));

    expect(onSubmit).toHaveBeenCalledWith('0 0 * * 6');
    expect(onClose).toHaveBeenCalled();
  });

  it('switches to the Advanced raw-text mode', async () => {
    const user = userEvent.setup();
    const { getByLabelText, getByRole } = renderWithTheme(
      <PipelineScheduleModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        cron="0 0 * * 6"
      />,
    );

    await user.click(getByLabelText('Advanced'));
    expect(getByRole('textbox')).toHaveValue('0 0 * * 6');
  });

  it('shows the human-readable cron description in Advanced mode', async () => {
    const user = userEvent.setup();
    const { getByLabelText, getByText } = renderWithTheme(
      <PipelineScheduleModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        cron="0 0 * * 6"
      />,
    );

    await user.click(getByLabelText('Advanced'));

    expect(getByText('At 00:00, only on Saturday')).toBeInTheDocument();
  });

  it('shows the parse error and disables Apply for an invalid Advanced-mode expression', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { getByLabelText, getByRole } = renderWithTheme(
      <PipelineScheduleModal
        open
        onClose={vi.fn()}
        onSubmit={onSubmit}
        cron="0 0 * * 6"
      />,
    );

    await user.click(getByLabelText('Advanced'));
    const textbox = getByRole('textbox');
    await user.clear(textbox);
    await user.type(textbox, 'not a cron');

    expect(getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('resets to Default mode when reopened', async () => {
    const user = userEvent.setup();
    const { getByLabelText, rerender, queryByRole } = renderWithTheme(
      <PipelineScheduleModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        cron="0 0 * * 6"
      />,
    );

    await user.click(getByLabelText('Advanced'));
    rerender(
      <PipelineScheduleModal
        open={false}
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        cron="0 0 * * 6"
      />,
    );
    rerender(
      <PipelineScheduleModal
        open
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        cron="0 0 * * 6"
      />,
    );

    expect(queryByRole('textbox')).not.toBeInTheDocument();
  });
});
