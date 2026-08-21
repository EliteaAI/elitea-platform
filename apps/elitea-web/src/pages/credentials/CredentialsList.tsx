/**
 * pages/credentials/CredentialsList.tsx — the credentials grid: search,
 * type filter, pagination, and (per credential) an owner icon, display
 * name, scope, and connection-status indicator. Ported from
 * `apps/elitea-ui/src/pages/Credentials/CredentialsList.jsx`.
 * Manifest COPY-467, ACT-039 (batch connection test on load).
 *
 * DISCLOSED SCOPE REDUCTION (see this unit's final report): the baseline's
 * `CardList` (pagination chrome, `TeamMates`/`AuthorInformation` right-rail
 * widgets) has no confirmed `shared/ui`/`widgets` equivalent yet — this
 * renders a plain row list plus a "Load more" button instead, and drops
 * the author/teammates panel entirely (cross-domain, out of this unit's
 * ownership fence). The baseline's "redirect to create-credential when a
 * private project has zero credentials" effect is also dropped — that is
 * a NAVIGATION side effect this page cannot itself trigger without a
 * router (see `CreateCredential.tsx`/`EditCredential.tsx`'s doc comments
 * for the same router-injection pattern used throughout this unit). The
 * type filter is derived from the CURRENTLY LOADED page
 * (`generateCredentialTagList`), not the full project catalogue the
 * baseline's `useListCredentialTypesQuery`-backed panel shows — a real,
 * disclosed narrowing (a type present only on a later page won't appear
 * as a filter chip until that page loads), traded for one fewer cross-page
 * request and a `useConfigurationsList`-only data path.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { credentialDisplayName, credentialScope, sortCredentialsPinnedFirst } from '@/entities/credential';
import { EliteaApiError } from '@/shared/api/generated/mutator';
import { t } from '@/shared/i18n';
import { BaseBtn } from '@/shared/ui/BaseBtn';
import { SimpleSearchBar } from '@/shared/ui/SimpleSearchBar';

import { generateCredentialTagList, normalizeCredentialPage, useConfigurationsList, useCredentialValidation } from '@/features/credentials';

import { CredentialsTypesPanel } from './CredentialsTypesPanel';

const PAGE_SIZE = 20;

/** `EliteaApiError`'s 403 case, the same test `pages/settings/Secrets.tsx` applies. */
function isForbiddenError(error: unknown): boolean {
  if (!(error instanceof EliteaApiError)) return false;
  const { failure } = error;
  return (failure.kind === 'http' || failure.kind === 'auth') && failure.status === 403;
}

export interface CredentialsListProps {
  readonly projectId: string;
  readonly onSelectCredential: (id: string) => void;
  readonly onCreateNew: () => void;
}

interface ListStatusProps {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly rowCount: number;
  readonly isSearching: boolean;
}

/**
 * The one line the list shows when it has no rows to show.
 *
 * A FAILED LIST IS NOT AN EMPTY LIST. Without the error branch a 403 or a 500
 * fell through to "You have no credentials.". The screen told the user their
 * project was empty when the request never returned a list at all. Observed on
 * a live deployment: the credentials screen read as empty while
 * GET /api/v2/configurations/configurations/1 answered 403 on every attempt.
 *
 * Split out of `CredentialsList` so the page component stays inside the §3.5
 * complexity budget.
 */
function ListStatus({ isLoading, isError, error, rowCount, isSearching }: ListStatusProps): ReactNode {
  if (isLoading) {
    return <Typography variant="bodyMedium">{t('credentials.list.loading', 'Loading…')}</Typography>;
  }
  if (isError) {
    return (
      <Typography
        variant="bodyMedium"
        role="alert"
        sx={(theme: Theme) => ({ color: theme.vars.palette.error.main })}
      >
        {isForbiddenError(error)
          ? t('credentials.list.forbidden', 'You do not have permission to read the credentials of this project.')
          : t('credentials.list.loadFailed', 'The credentials could not be loaded.')}
      </Typography>
    );
  }
  if (rowCount > 0) return null;
  return (
    <Typography variant="bodyMedium">
      {isSearching ? t('credentials.list.nothingFound', 'Nothing found.') : t('credentials.list.empty', 'You have no credentials.')}
    </Typography>
  );
}

export function CredentialsList({ projectId, onSelectCredential, onCreateNew }: CredentialsListProps): ReactNode {
  const [query, setQuery] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<readonly string[]>([]);
  const [page, setPage] = useState(0);
  const { batchValidateCredentials, getCredentialStatus } = useCredentialValidation();

  useEffect(() => {
    setPage(0);
  }, [selectedTypes, query]);

  const list = useConfigurationsList({
    projectId,
    page,
    pageSize: PAGE_SIZE,
    section: 'credentials',
    ...(selectedTypes.length > 0 ? { type: selectedTypes } : {}),
    includeShared: true,
    params: { query },
  });

  const normalized = useMemo(() => (list.data ? normalizeCredentialPage(list.data) : undefined), [list.data]);
  const allRows = useMemo(() => {
    const own = normalized?.items ?? [];
    const shared = normalized?.shared?.items ?? [];
    return sortCredentialsPinnedFirst([...own, ...shared]);
  }, [normalized]);

  const tagList = useMemo(() => generateCredentialTagList(allRows), [allRows]);

  useEffect(() => {
    if (allRows.length === 0) return;
    void batchValidateCredentials(
      allRows.map((row) => ({ projectId: row.projectId ?? projectId, credentialId: row.id, credentialType: row.type, data: row.data ?? {} })),
    );
  }, [allRows, batchValidateCredentials, projectId]);

  const total = normalized?.total ?? 0;
  const hasMore = (page + 1) * PAGE_SIZE < total;

  const toggleType = (type: string): void => {
    setSelectedTypes((prev) => (prev.includes(type) ? prev.filter((t2) => t2 !== type) : [...prev, type]));
  };

  return (
    <Box sx={containerSx}>
      <Box sx={mainColumnSx}>
        <Box sx={toolbarSx}>
          <SimpleSearchBar
            value={query}
            onChange={setQuery}
            placeholder={t('credentials.list.search', 'Search credentials')}
          />
          <BaseBtn
            variant="contained"
            color="primary"
            onClick={onCreateNew}
          >
            {t('credentials.list.create', 'New credential')}
          </BaseBtn>
        </Box>
        <ListStatus
          isLoading={list.isLoading}
          isError={list.isError}
          error={list.error}
          rowCount={allRows.length}
          isSearching={query !== ''}
        />
        {allRows.length > 0 && (
          <List>
            {allRows.map((row) => (
              // <ListItem disablePadding> wrapper: see ApplicationListPanel for
              // why `component="li"` on the button is not the fix.
              <ListItem
                key={row.id}
                disablePadding
              >
                <ListItemButton
                  onClick={() => {
                    onSelectCredential(row.id);
                  }}
                >
                  <ListItemText
                    primary={credentialDisplayName(row)}
                    secondary={`${row.type} · ${credentialScope(row)} · ${getCredentialStatus(row.id)}`}
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        )}
        {hasMore && (
          <BaseBtn
            variant="secondary"
            disabled={list.isFetching}
            onClick={() => {
              setPage((prev) => prev + 1);
            }}
          >
            {t('credentials.list.loadMore', 'Load more')}
          </BaseBtn>
        )}
      </Box>
      <Box sx={sideColumnSx}>
        <CredentialsTypesPanel
          tagList={tagList}
          selectedTypes={selectedTypes}
          onToggleType={toggleType}
        />
      </Box>
    </Box>
  );
}

const containerSx: SxProps<Theme> = (theme: Theme) => ({ display: 'flex', gap: theme.spacing(3), width: '100%' });
const mainColumnSx: SxProps<Theme> = (theme: Theme) => ({ flex: 1, display: 'flex', flexDirection: 'column', gap: theme.spacing(2) });
const sideColumnSx: SxProps<Theme> = { width: '18.75rem', flexShrink: 0 };
const toolbarSx: SxProps<Theme> = (theme: Theme) => ({ display: 'flex', alignItems: 'center', gap: theme.spacing(2) });
