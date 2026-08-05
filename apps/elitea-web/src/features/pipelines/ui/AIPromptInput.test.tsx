import { createRef } from 'react';

import { act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import { AIPromptInput } from './AIPromptInput';
import type { PromptInputHandle } from './AIPromptInput';

describe('AIPromptInput', () => {
  it('renders the placeholder text', () => {
    const { getByPlaceholderText } = renderWithTheme(<AIPromptInput />);
    expect(getByPlaceholderText('Describe your idea to generate or rewrite the value.')).toBeInTheDocument();
  });

  it('disables the send button until there is non-whitespace text', async () => {
    const user = renderWithTheme(<AIPromptInput />);
    const sendButton = user.getByRole('button', { name: 'Send' });
    expect(sendButton).toBeDisabled();

    await userEvent.type(user.getByPlaceholderText('Describe your idea to generate or rewrite the value.'), 'hello');
    expect(sendButton).not.toBeDisabled();
  });

  it('calls onGenerate with the typed prompt when the send button is clicked', async () => {
    const onGenerate = vi.fn();
    const ui = renderWithTheme(<AIPromptInput onGenerate={onGenerate} />);
    const textbox = ui.getByPlaceholderText('Describe your idea to generate or rewrite the value.');
    await userEvent.type(textbox, 'make it better');
    await userEvent.click(ui.getByRole('button', { name: 'Send' }));

    expect(onGenerate).toHaveBeenCalledWith('make it better');
  });

  it('sends on Enter without shift, but not with shift', async () => {
    const onGenerate = vi.fn();
    const ui = renderWithTheme(<AIPromptInput onGenerate={onGenerate} />);
    const textbox = ui.getByPlaceholderText('Describe your idea to generate or rewrite the value.');
    await userEvent.type(textbox, 'line one{Shift>}{Enter}{/Shift}');
    expect(onGenerate).not.toHaveBeenCalled();

    await userEvent.type(textbox, 'line two{Enter}');
    expect(onGenerate).toHaveBeenCalledWith('line one\nline two');
  });

  it('renders a stop button and calls onStop while isLoading', async () => {
    const onStop = vi.fn();
    const ui = renderWithTheme(
      <AIPromptInput
        isLoading
        onStop={onStop}
      />,
    );
    await userEvent.click(ui.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('exposes clear/getValue/setValue/focus via promptValueRef', async () => {
    const ref = createRef<PromptInputHandle>() as { current: PromptInputHandle | null };
    const ui = renderWithTheme(<AIPromptInput promptValueRef={ref} />);
    const textbox = ui.getByPlaceholderText('Describe your idea to generate or rewrite the value.');

    await userEvent.type(textbox, 'draft text');
    expect(ref.current?.getValue()).toBe('draft text');

    act(() => {
      ref.current?.setValue('replaced');
    });
    expect(ui.getByDisplayValue('replaced')).toBeInTheDocument();

    act(() => {
      ref.current?.clear();
    });
    expect(ui.queryByDisplayValue('replaced')).toBeNull();
  });

  it('disables the textbox and send button when disabled is set', () => {
    const ui = renderWithTheme(<AIPromptInput disabled />);
    expect(ui.getByPlaceholderText('Describe your idea to generate or rewrite the value.')).toBeDisabled();
    expect(ui.getByRole('button', { name: 'Send' })).toBeDisabled();
  });
});
