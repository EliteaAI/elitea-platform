/**
 * The list of wikis a project can see.
 *
 * Presentational only: it takes already-loaded data and renders it. The loading
 * and the repository filter live in `model/useWikiList.ts`, so both are
 * testable without a component tree.
 *
 * THE TWO EMPTY STATES ARE DIFFERENT, deliberately. "This project has generated
 * no wikis" and "this bucket has wikis and none belongs to your repository" are
 * the same blank screen to a user and completely different problems to
 * diagnose. The second usually means the toolkit's repository or branch does
 * not match what was generated, which is a thing the user can fix — so it says
 * so instead of showing nothing.
 */
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';

import { t } from '@/shared/i18n';
import { NoResultsMessage } from '@/shared/ui/NoResultsMessage';
import type { WikiManifest } from '@/entities/wiki';

export interface WikiListProps {
  /** Wikis belonging to the configured repository. */
  readonly wikis: readonly WikiManifest[];
  /** Every wiki in the bucket, so the empty state can tell the two cases apart. */
  readonly allWikis: readonly WikiManifest[];
  readonly selectedWikiId?: string | undefined;
  readonly onSelect: (wiki: WikiManifest) => void;
}

export function WikiList({
  wikis,
  allWikis,
  selectedWikiId,
  onSelect,
}: WikiListProps): React.JSX.Element {
  if (wikis.length === 0) {
    const otherWikisExist = allWikis.length > 0;
    return (
      <NoResultsMessage
        title={t('deepwiki.list.emptyTitle', 'No wiki yet')}
        description={
          otherWikisExist
            ? t(
                'deepwiki.list.noneForThisRepository',
                'No wiki has been generated for this repository and branch yet. Other wikis exist in this project; check the repository and branch in the toolkit settings.',
              )
            : t('deepwiki.list.empty', 'No wiki has been generated for this project yet.')
        }
      />
    );
  }

  return (
    <List dense disablePadding>
      {wikis.map((wiki) => (
        <ListItemButton
          key={wiki.wiki_id ?? wiki.wiki_version_id}
          selected={wiki.wiki_id === selectedWikiId}
          onClick={() => {
            onSelect(wiki);
          }}
        >
          <ListItemText
            primary={wiki.wiki_title ?? wiki.wiki_id}
            secondary={wiki.branch ? `${wiki.repository ?? ''} · ${wiki.branch}` : wiki.repository}
          />
        </ListItemButton>
      ))}
    </List>
  );
}
