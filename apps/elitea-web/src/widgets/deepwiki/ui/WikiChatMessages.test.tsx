import { ThemeProvider } from '@mui/material/styles';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DEFAULT_BRAND_PACK, DEFAULT_COLOR_SCHEME, buildEliteaTheme } from '@/shared/brand';

import { WikiChatMessages } from './WikiChatMessages';

const theme = buildEliteaTheme(DEFAULT_BRAND_PACK);

function show(ui: React.ReactElement) {
  return render(
    <ThemeProvider theme={theme} defaultMode={DEFAULT_COLOR_SCHEME}>
      {ui}
    </ThemeProvider>,
  );
}

describe('WikiChatMessages', () => {
  it('renders a question as PLAIN TEXT, not as markdown', () => {
    // A question about code is full of backticks and asterisks. Interpreting
    // it would silently eat what the user typed.
    show(<WikiChatMessages messages={[{ role: 'user', content: 'what does `**x**` do?' }]} streamingText="" />);
    expect(screen.getByText('what does `**x**` do?')).toBeVisible();
  });

  it('renders an answer as markdown', () => {
    const { container } = show(
      <WikiChatMessages messages={[{ role: 'assistant', content: 'see **api/router.go**' }]} streamingText="" />,
    );
    expect(container.querySelector('strong')?.textContent).toBe('api/router.go');
  });

  it('renders a failed answer as an alert rather than as prose', () => {
    show(
      <WikiChatMessages
        messages={[{ role: 'assistant', content: 'Sorry, I encountered an error: broke', isError: true }]}
        streamingText=""
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('broke');
  });

  it('shows the streamed answer under the conversation (DWIKI-012)', () => {
    show(<WikiChatMessages messages={[{ role: 'user', content: 'q' }]} streamingText="half an ans" />);
    expect(screen.getByTestId('wiki-chat-streaming')).toHaveTextContent('half an ans');
  });

  it('shows NOTHING for an empty stream', () => {
    // An empty bubble under every finished answer is worse than no bubble: the
    // user cannot tell it from an answer that came back blank.
    show(<WikiChatMessages messages={[{ role: 'user', content: 'q' }]} streamingText="" />);
    expect(screen.queryByTestId('wiki-chat-streaming')).toBeNull();
  });
});
