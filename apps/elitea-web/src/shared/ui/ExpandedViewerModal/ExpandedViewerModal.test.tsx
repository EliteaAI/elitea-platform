import { act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '../lib/testTheme';
import { ExpandedViewerModal } from '.';

// `Dialog` renders through a portal to `document.body` (same note as
// `BaseModal.test.tsx`) — RTL's bound queries already see portaled content.

describe('ExpandedViewerModal', () => {
  it('renders nothing to the DOM when closed', () => {
    const { queryByText } = renderWithTheme(
      <ExpandedViewerModal
        open={false}
        title="report.json"
        content="content"
      />,
    );
    expect(queryByText('report.json')).not.toBeInTheDocument();
  });

  it('renders a string title and the content', () => {
    const { getByText } = renderWithTheme(
      <ExpandedViewerModal
        open
        title="report.json"
        content="the file body"
      />,
    );
    expect(getByText('report.json')).toBeInTheDocument();
    expect(getByText('the file body')).toBeInTheDocument();
  });

  it('renders a node title as-is, bypassing the truncation wrapper', () => {
    const { getByTestId } = renderWithTheme(
      <ExpandedViewerModal
        open
        title={<span data-testid="custom-title">Custom</span>}
        content="content"
      />,
    );
    expect(getByTestId('custom-title')).toBeInTheDocument();
  });

  it('does not crash the truncation-detection timer when the title is a node (no ref ever attaches)', async () => {
    const { getByTestId } = renderWithTheme(
      <ExpandedViewerModal
        open
        title={<span data-testid="custom-title">Custom</span>}
      />,
    );
    // The internal 100ms check fires with `titleRef.current` still null for
    // a node title (only string titles attach the ref) — this waits past
    // that timer for real, to prove the null-ref guard holds rather than
    // throwing.
    await act(
      () =>
        new Promise((resolve) => {
          setTimeout(resolve, 150);
        }),
    );
    expect(getByTestId('custom-title')).toBeInTheDocument();
  });

  it('renders the footer node', () => {
    const { getByTestId } = renderWithTheme(
      <ExpandedViewerModal
        open
        title="report.json"
        footer={<div data-testid="modal-footer">footer</div>}
      />,
    );
    expect(getByTestId('modal-footer')).toBeInTheDocument();
  });

  it('forwards data-testid and closeButtonDataTestId', () => {
    const { getByTestId } = renderWithTheme(
      <ExpandedViewerModal
        open
        title="report.json"
        data-testid="viewer-modal"
        header={{ closeButtonDataTestId: 'viewer-close' }}
      />,
    );
    expect(getByTestId('viewer-modal')).toBeInTheDocument();
    expect(getByTestId('viewer-close')).toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { getByTestId } = renderWithTheme(
      <ExpandedViewerModal
        open
        title="report.json"
        onClose={onClose}
        header={{ closeButtonDataTestId: 'viewer-close' }}
      />,
    );
    await user.click(getByTestId('viewer-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('language selector', () => {
    it('is absent when no language prop is given', () => {
      const { queryByRole } = renderWithTheme(
        <ExpandedViewerModal
          open
          title="report.json"
        />,
      );
      expect(queryByRole('combobox')).not.toBeInTheDocument();
    });

    it('lists the given options and reports a selection via onChange', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      const { getByRole, findByRole } = renderWithTheme(
        <ExpandedViewerModal
          open
          title="report.json"
          language={{
            value: 'json',
            options: [
              { label: 'JSON', value: 'json' },
              { label: 'YAML', value: 'yaml' },
            ],
            onChange,
          }}
        />,
      );
      await user.click(getByRole('combobox'));
      const yamlOption = await findByRole('option', { name: 'YAML' });
      await user.click(yamlOption);
      expect(onChange).toHaveBeenCalledWith('yaml');
    });

    it('renders with no option selected when language.value is omitted', () => {
      const { getByRole } = renderWithTheme(
        <ExpandedViewerModal
          open
          title="report.json"
          language={{ options: [{ label: 'JSON', value: 'json' }] }}
        />,
      );
      expect(getByRole('combobox')).not.toHaveTextContent('JSON');
    });
  });

  describe('header extras', () => {
    it('renders custom buttons', () => {
      const { getByTestId } = renderWithTheme(
        <ExpandedViewerModal
          open
          title="report.json"
          header={{ customButtons: <button data-testid="custom-action">Export</button> }}
        />,
      );
      expect(getByTestId('custom-action')).toBeInTheDocument();
    });

    it('shows the copy button only when onCopy is supplied, and calls it (no clipboard/toast side effect owned here)', async () => {
      const user = userEvent.setup();
      const onCopy = vi.fn();
      const { queryByRole, getByRole, rerender } = renderWithTheme(
        <ExpandedViewerModal
          open
          title="report.json"
        />,
      );
      expect(queryByRole('button', { name: 'Copy to clipboard' })).not.toBeInTheDocument();

      rerender(
        <ExpandedViewerModal
          open
          title="report.json"
          header={{ onCopy }}
        />,
      );
      await user.click(getByRole('button', { name: 'Copy to clipboard' }));
      expect(onCopy).toHaveBeenCalledTimes(1);
    });
  });

  describe('title truncation tooltip', () => {
    let restoreScrollWidth: (() => void) | undefined;
    let restoreClientWidth: (() => void) | undefined;

    // Real timers on purpose: `user.hover()` + Vitest fake timers reliably
    // deadlocked here (userEvent's own pointer-event dispatch never resolved
    // under `vi.useFakeTimers()`, even with `advanceTimers` wired) — a known
    // rough edge, not something worth fighting for two assertions. Waiting
    // out the component's real 100ms detection delay plus MUI Tooltip's own
    // ~100ms `enterDelay` costs a little wall-clock time but is far more
    // robust than fighting that interaction.
    afterEach(() => {
      restoreScrollWidth?.();
      restoreClientWidth?.();
      restoreScrollWidth = undefined;
      restoreClientWidth = undefined;
    });

    function mockOverflow(overflowing: boolean): void {
      const scrollWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
      const clientWidthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
      Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
        configurable: true,
        get: () => (overflowing ? 400 : 100),
      });
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get: () => 100,
      });
      restoreScrollWidth = () => {
        if (scrollWidthDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', scrollWidthDescriptor);
      };
      restoreClientWidth = () => {
        if (clientWidthDescriptor) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidthDescriptor);
      };
    }

    function wait(ms: number): Promise<void> {
      return new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
    }

    it('shows a tooltip on hover once the title is measured as truncated', async () => {
      mockOverflow(true);
      const { getByText, findByRole } = renderWithTheme(
        <ExpandedViewerModal
          open
          title="a-very-long-report-filename.json"
        />,
      );

      await act(() => wait(150));
      fireEvent.mouseEnter(getByText('a-very-long-report-filename.json'));

      const tooltip = await findByRole('tooltip');
      expect(tooltip).toHaveTextContent('a-very-long-report-filename.json');
    });

    it('shows no tooltip when the title is not truncated', async () => {
      mockOverflow(false);
      const { getByText, queryByRole } = renderWithTheme(
        <ExpandedViewerModal
          open
          title="short.json"
        />,
      );

      await act(() => wait(150));
      fireEvent.mouseEnter(getByText('short.json'));
      await act(() => wait(200));

      expect(queryByRole('tooltip')).not.toBeInTheDocument();
    });
  });
});
