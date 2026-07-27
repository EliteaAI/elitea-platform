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
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { credentialDisplayName, credentialScope, sortCredentialsPinnedFirst } from '@/entities/credential';
import { t } from '@/shared/i18n';
import { BaseBtn } from '@/shared/ui/BaseBtn';
import { SimpleSearchBar } from '@/shared/ui/SimpleSearchBar';

import { generateCredentialTagList, normalizeCredentialPage, useConfigurationsList, useCredentialValidation } from '@/features/credentials';

import { CredentialsTypesPanel } from './CredentialsTypesPanel';

const PAGE_SIZE = 20;

export interface CredentialsListProps {
  readonly projectId: string;
  readonly onSelectCredential: (id: string) => void;
  readonly onCreateNew: () => void;
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
        {list.isLoading && <Typography variant="bodyMedium">{t('credentials.list.loading', 'Loading…')}</Typography>}
        {!list.isLoading && allRows.length === 0 && (
          <Typography variant="bodyMedium">
            {query ? t('credentials.list.nothingFound', 'Nothing found.') : t('credentials.list.empty', 'You have no credentials.')}
          </Typography>
        )}
        {allRows.length > 0 && (
          <List>
            {allRows.map((row) => (
              <ListItemButton
                key={row.id}
                onClick={() => {
                  onSelectCredential(row.id);
                }}
              >
                <ListItemText
                  primary={credentialDisplayName(row)}
                  secondary={`${row.type} · ${credentialScope(row)} · ${getCredentialStatus(row.id)}`}
                />
              </ListItemButton>
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
