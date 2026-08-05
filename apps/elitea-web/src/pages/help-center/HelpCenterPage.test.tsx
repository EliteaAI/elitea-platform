import { describe, expect, it } from 'vitest';

import { renderWithTheme } from '@/shared/ui/lib/testTheme';

import HelpCenterPage, { resolveLinks } from './HelpCenterPage';
import { RESOURCE_CARD_CONFIGS } from './lib/ResourceCardConfig';

const documentationConfig = RESOURCE_CARD_CONFIGS[0]!;

describe('resolveLinks (finding #3 regression)', () => {
  it('returns an empty array when the config value for the key is absent (current hardcoded-fallback state)', () => {
    expect(resolveLinks(documentationConfig, {})).toEqual([]);
  });

  it('returns an empty array when the config value is present but not an array', () => {
    expect(resolveLinks(documentationConfig, { [documentationConfig.linksKey]: 'not-an-array' })).toEqual([]);
  });

  it('returns the configured links verbatim once a real admin config value provides them', () => {
    const links = [
      { title: 'API Reference', url: 'https://docs.example.com/api' },
      { title: 'Legacy guide' },
    ];
    expect(resolveLinks(documentationConfig, { [documentationConfig.linksKey]: links })).toEqual(links);
  });

  it("only reads the given card's own linksKey, not another card's", () => {
    const releaseNotesConfig = RESOURCE_CARD_CONFIGS[1]!;
    const links = [{ title: 'v2.3.0 notes', url: 'https://example.com/changelog' }];
    // Links are stored under release notes' key — the documentation card must not see them.
    expect(resolveLinks(documentationConfig, { [releaseNotesConfig.linksKey]: links })).toEqual([]);
  });
});

describe('HelpCenterPage', () => {
  it('renders a card for every RESOURCE_CARD_CONFIGS entry, each showing "No links configured" (current hardcoded-fallback state)', () => {
    const { getByText, getAllByText } = renderWithTheme(<HelpCenterPage />);

    RESOURCE_CARD_CONFIGS.forEach(config => {
      expect(getByText(config.defaultTitle)).toBeInTheDocument();
    });
    expect(getAllByText('No links configured')).toHaveLength(RESOURCE_CARD_CONFIGS.length);
  });
});
