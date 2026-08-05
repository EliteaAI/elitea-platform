import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import {
  InProgressIndicator,
  ProcessStepIcon,
  RunStatus,
  StateItemView,
  StateValueModal,
} from './RunStateDialog.parts';

describe('RunStateDialog.parts', () => {
  it('RunStatus renders the raw status text', () => {
    renderWithTheme(<RunStatus status="Completed" />);
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('ProcessStepIcon renders a real button and fires onSelect(index) on click', () => {
    const onSelect = vi.fn();
    renderWithTheme(
      <ProcessStepIcon
        active={false}
        tooltip="step-1"
        index={2}
        onSelect={onSelect}
        isError={false}
      />,
    );

    // A native <button> (not a role="button" <div>) — Enter/Space
    // activation then comes from the browser's own default action, not
    // component-level code, so there is nothing extra to unit-test for it.
    const control = screen.getByRole('button', { name: 'step-1' });
    expect(control.tagName).toBe('BUTTON');
    fireEvent.click(control);
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('StateItemView renders Before/After sections and wires fullscreen clicks', () => {
    const onFullScreen = vi.fn();
    renderWithTheme(
      <StateItemView
        name="counter"
        valueBefore={1}
        valueAfter={2}
        onFullScreen={onFullScreen}
      />,
    );

    expect(screen.getByText('Before')).toBeInTheDocument();
    expect(screen.getByText('After')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();

    fireEvent.click(screen.getAllByLabelText('Full screen view')[0] as HTMLElement);
    expect(onFullScreen).toHaveBeenCalledWith('counter', 1);
  });

  it('InProgressIndicator shows the step name and "Performing" label', () => {
    renderWithTheme(<InProgressIndicator stepName="llm_call" />);
    expect(screen.getByText('llm_call:')).toBeInTheDocument();
    expect(screen.getByText('Performing')).toBeInTheDocument();
  });

  it('StateValueModal shows the label and stringified value, and closes', () => {
    const onClose = vi.fn();
    renderWithTheme(
      <StateValueModal
        open
        onClose={onClose}
        label="counter"
        value={{ a: 1 }}
      />,
    );

    expect(screen.getByText('counter')).toBeInTheDocument();
    expect(screen.getByText(JSON.stringify({ a: 1 }))).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
