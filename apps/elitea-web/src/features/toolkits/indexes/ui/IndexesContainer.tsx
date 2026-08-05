import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { BaseModal } from '@/shared/ui/BaseModal';
import { DeleteEntityModal } from '@/shared/ui/DeleteEntityModal';

import { useDeleteIndexItemMutation, useIndexScheduleQuery, useIndexesListQuery } from '../api/indexesApi';
import { IndexViewsEnum, NEW_INDEX_ID, SearchParams } from '../lib/constants/indexDetails.constants';
import { toDisplayString } from '../lib/helpers/displayString.local';
import { useSelectedProjectId } from '../lib/hooks/useSelectedProjectId';
import { mergeIndexesOverlay, useIndexesStore } from '../model/indexesStore';
import type { IndexRow } from '../model/indexesStore';

import type { IndexDetailsProps } from './IndexDetails/IndexDetails';
import { IndexDetails } from './IndexDetails/IndexDetails';
import { IndexesList } from './IndexesList/IndexesList';

/**
 * Port of `apps/elitea-ui/src/[fsd]/features/toolkits/indexes/ui/
 * IndexesContainer.jsx` (unit A4a) — the top-level "indexes" tab body:
 * owns the currently-selected index, the delete-confirm modal, the
 * "opened from a notification link but the index is gone" alert, and the
 * URL-driven auto-select-on-load behaviour.
 *
 * DISCLOSED DEVIATION (URL search param access): the baseline uses
 * `react-router-dom`'s `useSearchParams`. This app uses TanStack Router
 * (spec §2.3), whose typed `useSearch`/`useNavigate` are bound to a
 * specific, statically-registered ROUTE — this sub-unit owns the `indexes`
 * feature slice, not the route tree (unit R1's ownership; no
 * `indexes`-tab route registration exists to import a typed search schema
 * from). Reading/writing `?index_name=` via the plain `URLSearchParams`
 * Web API + `window.history.replaceState` avoids that coupling entirely —
 * same net effect (read once, strip the param, no extra navigation
 * entry) as the baseline's `setSearchParams(next, {replace: true})| just
 * through a router-agnostic primitive. `AlertDialog` (baseline:
 * `components/AlertDialog`) has no `shared/ui` port; the "index not found"
 * notice below composes `shared/ui/BaseModal` directly instead, matching
 * `DiscardButton.tsx`'s own precedent of building its confirm dialog on
 * `BaseModal` rather than a dedicated alert primitive.
 *
 * All of `IndexDetails`'s injected dependencies (DI props — see that
 * file's own doc comment) pass straight through: this container has no
 * opinion on `useToolkitChat`/`useSelectedToolSchema`/`useToolkitSchemas`/
 * `ToolFormField`/the chat-UI components/MCP wiring/credentials-select
 * rendering — it is purely a list+selection composition root, exactly like
 * the baseline.
 */

const INDEX_NAME_PARAM = SearchParams.IndexName;

/**
 * Stable empty-array fallback for `serverIndexes ?? EMPTY_INDEX_LIST` below.
 * A fresh `[]` literal there would change identity on every render while
 * the query is still loading, which is exactly the "changes every render"
 * `react-hooks/exhaustive-deps` violation this module-level constant fixes
 * — a real dependency-stability bug, not a lint-suppression workaround
 * (the two `useEffect`s below both legitimately need `indexesList` in
 * their dep arrays to react to genuine data changes).
 */
const EMPTY_INDEX_LIST: readonly IndexRow[] = [];

function readIndexNameParam(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(INDEX_NAME_PARAM);
}

function clearIndexNameParam(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete(INDEX_NAME_PARAM);
  window.history.replaceState(window.history.state as unknown, '', url);
}

type IndexesContainerDetailsProps = Omit<
  IndexDetailsProps,
  'index' | 'view' | 'traceNewIndex' | 'refetchIndexesList' | 'handleDeleteIndex' | 'isIndexDeleting' | 'selectedIndexTools' | 'toolkitId' | 'values'
>;

export interface IndexesContainerProps extends IndexesContainerDetailsProps {
  readonly toolkitId: string;
  readonly selectedIndexTools: readonly string[];
  readonly editToolDetail?: IndexDetailsProps['editToolDetail'];
  readonly values: Record<string, unknown>;
}

export function IndexesContainer(props: IndexesContainerProps): ReactNode {
  const { toolkitId, selectedIndexTools, values, ...detailsProps } = props;

  const skipAutoSelection = useRef(false);
  const hasSelectedFromUrlRef = useRef(false);
  const detailsKeyRef = useRef(0);

  const projectId = useSelectedProjectId();
  const addTempLocalIndex = useIndexesStore((state) => state.addTempLocalIndex);
  const updateIndexDepMeta = useIndexesStore((state) => state.updateIndexDepMeta);
  const tempIndexes = useIndexesStore((state) => state.tempIndexes);
  const indexPatches = useIndexesStore((state) => state.indexPatches);

  const [indexNameFromUrl, setIndexNameFromUrl] = useState<string | null>(() => readIndexNameParam());

  useIndexScheduleQuery({ projectId, toolkitId });
  const { data: serverIndexes, isLoading, isFetching, refetch } = useIndexesListQuery({ toolkitId, projectId });
  const indexesList = serverIndexes ?? EMPTY_INDEX_LIST;

  const [currentIndex, setCurrentIndex] = useState<IndexRow | null>(null);
  const [deleteIndexModal, setDeleteIndexModal] = useState(false);
  const [indexNotFoundOpen, setIndexNotFoundOpen] = useState(false);

  const deleteIndexItemMutation = useDeleteIndexItemMutation();

  useEffect(() => {
    if (!indexNameFromUrl || isLoading || isFetching || hasSelectedFromUrlRef.current) return;

    const targetIndex = indexesList.find((idx) => idx.metadata['collection'] === indexNameFromUrl);
    hasSelectedFromUrlRef.current = true;

    if (targetIndex) {
      clearIndexNameParam();
      setIndexNameFromUrl(null);
      setCurrentIndex(targetIndex);
      // Guards the very next run of the auto-select-first-valid effect
      // below (its dependency array includes `indexNameFromUrl`, which
      // this same branch just flips from truthy to `null` — without this
      // guard that effect re-runs on the next render and immediately
      // overwrites the index the user just navigated to via the
      // notification link with whatever sorts first. DISCLOSED FIX, not a
      // byte-faithful port: the baseline's equivalent effect has the
      // identical dependency shape (`searchParams`-derived `indexNameFromUrl`
      // in its own dep array) and so is subject to the same race — treated
      // here as a real correctness bug worth fixing rather than porting
      // verbatim, since silently re-selecting away from a link the user
      // explicitly followed is a genuine UX regression, not a behavior
      // this domain plausibly intends.
      skipAutoSelection.current = true;
    } else {
      setIndexNotFoundOpen(true);
    }
  }, [indexNameFromUrl, indexesList, isLoading, isFetching]);

  useEffect(() => {
    if (isLoading || isFetching || indexNameFromUrl) return;

    if (skipAutoSelection.current) {
      skipAutoSelection.current = false;
      return;
    }

    const reindexing = (currentIndex?.metadata['history'] as readonly unknown[] | undefined)?.length ?? 0;
    const firstValidIndex = indexesList.find((idx) => idx.metadata['indexed'] !== undefined);
    const reindexingCurrentIndex = indexesList.find((idx) => idx.id === currentIndex?.id);

    if (firstValidIndex) setCurrentIndex(firstValidIndex);
    if (reindexingCurrentIndex && reindexing >= 1) setCurrentIndex(reindexingCurrentIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexesList, isLoading, isFetching, indexNameFromUrl]);

  const view = currentIndex?.id === NEW_INDEX_ID ? IndexViewsEnum.create : IndexViewsEnum.edit;

  const indexesWithStub = (() => {
    if (currentIndex && currentIndex.id === NEW_INDEX_ID) {
      return mergeIndexesOverlay(indexesList, [currentIndex, ...tempIndexes], indexPatches);
    }
    if (currentIndex && currentIndex.id !== NEW_INDEX_ID) {
      const patchedList = indexesList.map((item) => ({
        ...item,
        metadata: { ...item.metadata, ...(item.id === currentIndex.id ? { state: currentIndex.metadata['state'] } : {}) },
      }));
      return mergeIndexesOverlay(patchedList, tempIndexes, indexPatches);
    }
    return mergeIndexesOverlay(indexesList, tempIndexes, indexPatches);
  })();

  const handleSelectIndex = useCallback(
    (index: IndexRow) => {
      setCurrentIndex((prev) => {
        if (prev?.id === NEW_INDEX_ID && prev.metadata['state'] === 'in_progress') {
          addTempLocalIndex({ ...prev, id: crypto.randomUUID() });
          skipAutoSelection.current = true;
        }
        if (prev?.id === NEW_INDEX_ID && index.id === NEW_INDEX_ID) detailsKeyRef.current += 1;
        return index;
      });
    },
    [addTempLocalIndex],
  );

  const traceNewIndex = useCallback(
    (id: string | null, metadata: Record<string, unknown>) => {
      setTimeout(() => {
        if (id && id !== NEW_INDEX_ID) {
          updateIndexDepMeta(id, {
            ...(typeof metadata['state'] === 'string' ? { state: metadata['state'] } : {}),
            ...(typeof metadata['task_id'] === 'string' ? { task_id: metadata['task_id'] } : {}),
            ...(typeof metadata['conversation_id'] === 'string' ? { conversation_id: metadata['conversation_id'] } : {}),
          });
        }
        setCurrentIndex((prev) => (prev ? { ...prev, metadata: { ...prev.metadata, ...metadata } } : prev));
      }, 500);
    },
    [updateIndexDepMeta],
  );

  const handleRefetchIndexesList = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const closeDeleteIndexModal = useCallback(() => setDeleteIndexModal(false), []);
  const handleCloseIndexNotFound = useCallback(() => {
    setIndexNotFoundOpen(false);
    clearIndexNameParam();
    setIndexNameFromUrl(null);
  }, []);
  const handleDeleteIndex = useCallback(() => setDeleteIndexModal(true), []);

  const confirmIndexDeleting = useCallback(async () => {
    if (!currentIndex || deleteIndexItemMutation.isPending || projectId === undefined) return;
    try {
      await deleteIndexItemMutation.mutateAsync({
        projectId,
        toolkitId,
        indexId: currentIndex.id,
        indexName: toDisplayString(currentIndex.metadata['collection']),
      });
      setDeleteIndexModal(false);
      setCurrentIndex(null);
    } catch {
      // The baseline surfaces this via `useToast` — see `IndexActions.tsx`'s
      // own doc comment for the disclosed, already-established platform gap.
    }
  }, [currentIndex, deleteIndexItemMutation, projectId, toolkitId]);

  return (
    <Box sx={{ display: 'flex', flexGrow: 1, height: '100%', paddingLeft: '1.5rem', paddingRight: '1.5rem' }}>
      <IndexesList
        handleAddIndex={() => handleSelectIndex({ id: NEW_INDEX_ID, metadata: { collection: 'New Index', state: '' } })}
        indexesList={indexesWithStub}
        onIndexClick={handleSelectIndex}
        currentIndex={currentIndex}
        loading={isLoading || isFetching}
      />
      {currentIndex && (
        <IndexDetails
          key={`${currentIndex.id}-${detailsKeyRef.current}`}
          {...detailsProps}
          index={currentIndex}
          traceNewIndex={traceNewIndex}
          view={view}
          refetchIndexesList={() => void handleRefetchIndexesList()}
          handleDeleteIndex={handleDeleteIndex}
          isIndexDeleting={deleteIndexItemMutation.isPending}
          selectedIndexTools={selectedIndexTools}
          toolkitId={toolkitId}
          values={values}
        />
      )}
      {currentIndex && (
        <DeleteEntityModal
          name={toDisplayString(currentIndex.metadata['collection'])}
          shouldRequestInputName
          open={deleteIndexModal}
          onClose={closeDeleteIndexModal}
          onConfirm={() => void confirmIndexDeleting()}
        />
      )}
      <BaseModal
        open={indexNotFoundOpen}
        onClose={handleCloseIndexNotFound}
        title={t('features.toolkits.indexesContainer.notFoundTitle', 'Item no longer exists')}
        content={<Typography variant="bodyMedium">This item was deleted and can&apos;t be opened.</Typography>}
        actions={{
          node: (
            <Button
              variant="elitea"
              color="primary"
              onClick={handleCloseIndexNotFound}
            >
              Got it
            </Button>
          ),
        }}
      />
    </Box>
  );
}
