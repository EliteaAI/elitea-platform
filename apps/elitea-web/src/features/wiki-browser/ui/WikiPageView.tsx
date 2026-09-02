/**
 * DWIKI-003 — one wiki page's markdown, fetched and rendered.
 *
 * THE PAGE LIST COMES FROM THE MANIFEST, not from a second listing. The
 * provider writes `pages[]` into the manifest as the record of what it
 * generated, and listing the bucket again would show files the manifest does
 * not claim — an index rebuilt from the filesystem rather than from what the
 * generation said it produced.
 *
 * Markdown goes through `shared/ui/Markdown`, this app's `marked` + sanitise
 * path. The vendored bundle used `react-markdown` + `remark-gfm`, neither of
 * which this app has.
 */
import { useMemo, useState } from 'react';

import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import { useQuery } from '@tanstack/react-query';

import { fetchWikiPage, type WikiManifest } from '@/entities/wiki';
import { t } from '@/shared/i18n';
import { Markdown } from '@/shared/ui/Markdown';

export interface WikiPageViewProps {
  readonly projectId: string | number;
  readonly wiki: WikiManifest;
  /**
   * How a page's markdown is rendered.
   *
   * A SLOT, because the richer renderer — mermaid blocks with a quick fix —
   * needs `features/chat-messages`, which `no-sideways-features` lets only a
   * widget import. The default is plain markdown, which is what a caller with
   * no widget above it gets.
   */
  readonly renderContent?: (markdown: string, pageKey: string) => React.ReactNode;
  /** The key of the page to open, when the caller wants one other than the first. */
  readonly openPage?: string | undefined;
}

/** The label a page path is shown under: its file name without the extension. */
function pageLabel(page: string): string {
  const last = page.split('/').pop() ?? page;
  return last.replace(/\.md$/i, '');
}

export function WikiPageView({
  projectId,
  wiki,
  renderContent,
  openPage,
}: WikiPageViewProps): React.JSX.Element {
  const pages = useMemo(() => wiki.pages ?? [], [wiki.pages]);
  const [selected, setSelected] = useState<string | undefined>(openPage);

  // The FIRST page is shown by default, so opening a wiki lands on content
  // rather than on a second thing to click. `selected ?? pages[0]` rather than
  // seeding state: seeding it would keep the previous wiki's page after the
  // selection moves to a different wiki.
  const active = selected !== undefined && pages.includes(selected) ? selected : pages[0];

  const wikiId = wiki.wiki_id ?? '';
  // WRAPPED, because react-query refuses `undefined` as query data — it
  // reports it as an error. `fetchWikiPage` returns undefined for an object it
  // cannot read as text, so an unwrapped queryFn turns "not readable" into
  // "could not be loaded", and the unreadable branch below is unreachable.
  // Found by the test for that branch, not by reading.
  const query = useQuery({
    queryKey: ['deepwiki', 'page', projectId, wikiId, active],
    enabled: wikiId !== '' && active !== undefined,
    queryFn: async () => ({ text: (await fetchWikiPage(projectId, wikiId, active ?? '')) ?? null }),
  });

  if (pages.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" data-testid="wiki-page-none">
        {t('deepwiki.page.none', 'This wiki records no pages.')}
      </Typography>
    );
  }

  return (
    <Box data-testid="wiki-page-view">
      <List dense disablePadding>
        {pages.map((page) => (
          <ListItemButton
            key={page}
            selected={page === active}
            onClick={() => {
              setSelected(page);
            }}
          >
            <ListItemText primary={pageLabel(page)} secondary={page} />
          </ListItemButton>
        ))}
      </List>

      <PageBody
        state={
          query.isPending
            ? { kind: 'loading' }
            : query.isError
              ? { kind: 'error' }
              : query.data.text === null
                ? { kind: 'unreadable' }
                : { kind: 'text', text: query.data.text }
        }
        render={(text) =>
          renderContent === undefined ? <Markdown>{text}</Markdown> : renderContent(text, `${wikiId}/${active ?? ''}`)
        }
      />
    </Box>
  );
}

type PageState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'text'; readonly text: string };

/**
 * The four states a page can be in, as one switch.
 *
 * Split out for the complexity budget, and it reads better for it: the parent
 * decides WHICH state the query is in, this decides what each one looks like.
 * An EMPTY page and a missing one stay different facts — `unreadable` means the
 * object was not text this reader can show, and rendering nothing would look
 * like a page that says nothing.
 */
function PageBody({
  state,
  render,
}: {
  readonly state: PageState;
  readonly render: (text: string) => React.ReactNode;
}): React.JSX.Element {
  switch (state.kind) {
    case 'loading':
      return <Typography variant="body2">{t('deepwiki.page.loading', 'Loading the page…')}</Typography>;
    case 'error':
      return (
        <Alert severity="warning" data-testid="wiki-page-error">
          {t('deepwiki.page.failed', 'This wiki page could not be loaded.')}
        </Alert>
      );
    case 'unreadable':
      return (
        <Alert severity="info" data-testid="wiki-page-unreadable">
          {t('deepwiki.page.unreadable', 'This wiki page is not readable as text.')}
        </Alert>
      );
    case 'text':
      return <Box data-testid="wiki-page-content">{render(state.text)}</Box>;
  }
}
