import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';
import { ThemeProvider } from '@mui/material/styles';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CreateToolkitToolTabBar, isPrebuildMcpType } from './CreateToolkitToolTabBar';
import type { CreateToolkitToolTabBarProps } from './CreateToolkitToolTabBar';

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function renderBar(props: Partial<CreateToolkitToolTabBarProps> = {}) {
  return render(
    <ThemeProvider
      theme={theme}
      defaultMode={DEFAULT_COLOR_SCHEME}
    >
      <CreateToolkitToolTabBar
        toolkitType="github"
        isDirty
        isSaving={false}
        onSave={vi.fn()}
        onClearEditTool={vi.fn()}
        {...props}
      />
    </ThemeProvider>,
  );
}

describe('isPrebuildMcpType', () => {
  it('is true for mcp_-prefixed types other than the bare "mcp" type', () => {
    expect(isPrebuildMcpType('mcp_github')).toBe(true);
  });

  it('is false for the bare "mcp" (remote MCP) type', () => {
    expect(isPrebuildMcpType('mcp')).toBe(false);
  });

  it('is false for a non-mcp type', () => {
    expect(isPrebuildMcpType('github')).toBe(false);
  });

  it('is false for a non-string value', () => {
    expect(isPrebuildMcpType(undefined)).toBe(false);
  });
});

describe('CreateToolkitToolTabBar', () => {
  it('is disabled when no type has been selected', () => {
    renderBar({ toolkitType: undefined });
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('is disabled while not dirty', () => {
    renderBar({ isDirty: false });
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('is disabled while saving', () => {
    renderBar({ isSaving: true });
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
  });

  it('calls onSave on click when enabled', async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    renderBar({ onSave });

    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('shows Save Credentials label when hasNotSavedCredentials is true', () => {
    renderBar({ hasNotSavedCredentials: true });
    expect(screen.getByRole('button', { name: /save credentials/i })).toBeInTheDocument();
  });

  it('calls onClearEditTool after confirming the discard dialog', async () => {
    const onClearEditTool = vi.fn();
    const user = userEvent.setup();
    renderBar({ onClearEditTool });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const dialog = within(document.body).getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }));

    expect(onClearEditTool).toHaveBeenCalledTimes(1);
  });
});
