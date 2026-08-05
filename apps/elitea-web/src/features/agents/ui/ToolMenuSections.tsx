import type { ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

import { useNavigate, useRouterState } from '@tanstack/react-router';

import { isMcpToolkit } from '@/entities/toolkit';
import type { Toolkit } from '@/entities/toolkit';
import { useListToolkitInstances } from '@/shared/api/generated/toolkits/toolkits';
import type { Application } from '@/shared/api/generated/model';
import { SearchParams } from '@/shared/lib/params';
import { BaseBtn } from '@/shared/ui/BaseBtn';
import { PlusIcon } from '@/shared/ui/icons/plus-icon';

import type { AssociationCandidate } from '../api/useAgentPipelineAssociation';

import { EntityIcon } from './EntityIcon';
import { ToolMenuDropdown } from './ToolMenuDropdown';
import type { ToolMenuDropdownItem } from './ToolMenuDropdown';

/**
 * `ToolMenu.tsx`'s section subcomponents and their pure/data-fetching
 * helpers — split into this sibling file purely to keep `ToolMenu.tsx`
 * itself under the §3.5 400-line-per-file budget (a single-file shape was
 * 488 lines). See `ToolMenu.tsx`'s own module doc comment for the full
 * porting/gap disclosure this file is part of.
 *
 * **"Create new toolkit" round trip — outbound half.** `InstanceAddSection`
 * (below) is the baseline's `handleCreateNewToolkit`
 * (`ToolMenu.jsx:302-337`): navigating to the toolkit/MCP creation route
 * with `SearchParams.SourceApplicationId`/`SearchParams.ReturnUrl` (this
 * screen's own href, so the creation page can send the user back) wired on.
 * `SearchParams.IsMCP` (`mcp`) is also set for the MCP variant, matching the
 * baseline's `currentParams.set(SearchParams.IsMCP, 'true')`. Both param
 * keys are real, already-registered `paramSchemas` entries
 * (`src/routes/-search/params.ts`) that `/agents/$tab`/`/agents/$tab/
 * $agentId` already declare in their `validateSearch` — this file spends
 * them, it does not invent them. The RETURN half (the not-yet-built
 * toolkit-creation page reading these two params and appending
 * `?newToolkitId=`/`?mcp=` on its way back) is out of this unit's ownership
 * fence; `ToolMenu.tsx`'s own module doc comment covers the inbound half
 * this file's sibling owns.
 */

const EMPTY_TOOLKITS: readonly Toolkit[] = [];

function toToolkitInstance(row: unknown): Toolkit {
  return row as Toolkit;
}

/** `Application` row -> the `{data: {id}}` shape `useFilterAddedItems`'s `filterAgents`/`filterPipelines` match against. */
function toEntityMenuItem(app: Application): { readonly data: { readonly id: string }; readonly app: Application } {
  return { data: { id: app.id }, app };
}

/* ── toolkit instances (shared source for the Toolkit and MCP dropdowns) ──── */

export function useToolkitInstanceRows(projectId: string | undefined, limit: number): { readonly rows: readonly Toolkit[]; readonly isFetching: boolean } {
  const query = useListToolkitInstances(projectId ?? '', { limit }, { query: { enabled: projectId !== undefined } });
  const rows = (query.data as { data?: { rows?: unknown[] } } | undefined)?.data?.rows?.map(toToolkitInstance) ?? EMPTY_TOOLKITS;
  return { rows, isFetching: query.isFetching };
}

function buildInstanceItems(
  rows: readonly Toolkit[],
  addedToolkitIds: ReadonlySet<string | number>,
  isMcp: boolean,
  search: string,
  onAttach: ((toolkit: Toolkit) => void) | undefined,
  onClose: () => void,
): readonly ToolMenuDropdownItem[] {
  const lowerSearch = search.toLowerCase();
  return rows
    .filter((toolkit) => isMcpToolkit(toolkit) === isMcp && !addedToolkitIds.has(toolkit.id) && toolkit.name.toLowerCase().includes(lowerSearch))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((toolkit) => ({
      key: toolkit.id,
      label: toolkit.name,
      description: toolkit.description,
      icon: (
        <EntityIcon
          entityType="toolkit"
          icon={{}}
        />
      ),
      onClick: () => {
        onAttach?.(toolkit);
        onClose();
      },
    }));
}

/* ── agents / pipelines (one parametrized builder instead of two copies) ──── */

function buildEntityIcon(entityType: 'agent' | 'pipeline', app: Application): ReactNode {
  return (
    <EntityIcon
      entityType={entityType}
      icon={app.icon ? { url: app.icon } : {}}
    />
  );
}

export function useEntityAssociationItems(
  rows: readonly Application[],
  excludeId: number | undefined,
  filterItems: <T extends { readonly data?: { readonly id?: string | number | undefined } | undefined }>(items: readonly T[] | undefined) => readonly T[],
  entityType: 'agent' | 'pipeline',
  associate: (candidate: AssociationCandidate) => void,
): readonly ToolMenuDropdownItem[] {
  return useMemo((): readonly ToolMenuDropdownItem[] => {
    const candidates = rows.filter((app) => app.id !== String(excludeId)).map(toEntityMenuItem);
    const available = [...filterItems(candidates)].sort((a, b) => a.app.name.localeCompare(b.app.name));
    return available.map(({ app }) => ({
      key: app.id,
      label: app.name,
      description: app.description,
      icon: buildEntityIcon(entityType, app),
      onClick: () => associate({ id: Number(app.id), name: app.name }),
    }));
  }, [rows, excludeId, filterItems, entityType, associate]);
}

/* ── the repeated "add" button + tooltip pattern ───────────────────────────── */

interface AddMenuButtonProps {
  readonly label: string;
  readonly disabled: boolean;
  readonly tooltip: string;
  readonly onClick: (event: { readonly currentTarget: HTMLElement }) => void;
  readonly testId?: string;
}

function AddMenuButton({ label, disabled, tooltip, onClick, testId }: AddMenuButtonProps): ReactNode {
  return (
    <BaseBtn
      {...(testId !== undefined ? { 'data-testid': testId } : {})}
      variant="iconLabel"
      startIcon={<PlusIcon />}
      disabled={disabled}
      title={disabled ? tooltip : undefined}
      onClick={onClick}
    >
      {label}
    </BaseBtn>
  );
}

/* ── one self-contained section per add-button ─────────────────────────────── */

/** User-visible copy for one `InstanceAddSection`, grouped into its own object to keep the component's own prop count under the §3.5 12-prop budget. */
interface InstanceSectionCopy {
  readonly label: string;
  readonly searchPlaceholder: string;
  readonly emptyMessage: string;
}

export interface InstanceSectionProps {
  readonly copy: InstanceSectionCopy;
  readonly testId?: string;
  readonly isEntityUnsaved: boolean;
  readonly tooltip: string;
  readonly isMcp: boolean;
  readonly rows: readonly Toolkit[];
  readonly addedToolkitIds: ReadonlySet<string | number>;
  readonly isFetching: boolean;
  readonly onAttach: ((toolkit: Toolkit) => void) | undefined;
  readonly onLoadMore: () => void;
  readonly createRoute: '/toolkits/create' | '/mcps/create';
  /** The current agent/pipeline's numeric id — sent as `SearchParams.SourceApplicationId` on "Create new" navigation (see this file's module doc comment). `undefined` while the entity is unsaved, but `onCreateNew` can only fire once the "Create new" menu item is reachable, which requires a saved entity (`isEntityUnsaved` disables the add button itself). */
  readonly sourceApplicationId: number | undefined;
}

export function InstanceAddSection({ copy, testId, isEntityUnsaved, tooltip, isMcp, rows, addedToolkitIds, isFetching, onAttach, onLoadMore, createRoute, sourceApplicationId }: InstanceSectionProps): ReactNode {
  const navigate = useNavigate();
  const currentHref = useRouterState({ select: (routerState) => routerState.location.href });
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [search, setSearch] = useState('');
  const close = useCallback(() => {
    setAnchor(null);
    setSearch('');
  }, []);

  return (
    <>
      <AddMenuButton
        {...(testId !== undefined ? { testId } : {})}
        label={copy.label}
        disabled={isEntityUnsaved}
        tooltip={tooltip}
        onClick={(event) => setAnchor(event.currentTarget)}
      />
      <ToolMenuDropdown
        anchorEl={anchor}
        onClose={close}
        items={buildInstanceItems(rows, addedToolkitIds, isMcp, search, onAttach, () => setAnchor(null))}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder={copy.searchPlaceholder}
        isLoading={isFetching}
        emptyMessage={copy.emptyMessage}
        onCreateNew={() => {
          setAnchor(null);
          void navigate({
            to: createRoute,
            search: {
              ...(sourceApplicationId !== undefined ? { [SearchParams.SourceApplicationId]: String(sourceApplicationId) } : {}),
              [SearchParams.ReturnUrl]: currentHref,
              ...(isMcp ? { [SearchParams.IsMCP]: 'true' } : {}),
            },
          });
        }}
        onScrollNearEnd={onLoadMore}
      />
    </>
  );
}

/** Same grouping rationale as `InstanceSectionCopy`. */
interface EntitySectionCopy {
  readonly label: string;
  readonly searchPlaceholder: string;
  readonly emptyMessage: string;
}

export interface EntitySectionProps {
  readonly copy: EntitySectionCopy;
  readonly isEntityUnsaved: boolean;
  readonly tooltip: string;
  readonly items: readonly ToolMenuDropdownItem[];
  readonly isFetching: boolean;
  readonly search: string;
  readonly onSearchChange: (value: string) => void;
  readonly onOpen: (anchor: HTMLElement) => void;
  readonly anchor: HTMLElement | null;
  readonly onClose: () => void;
}

export function EntityAddSection({ copy, isEntityUnsaved, tooltip, items, isFetching, search, onSearchChange, onOpen, anchor, onClose }: EntitySectionProps): ReactNode {
  return (
    <>
      <AddMenuButton
        label={copy.label}
        disabled={isEntityUnsaved}
        tooltip={tooltip}
        onClick={(event) => onOpen(event.currentTarget)}
      />
      <ToolMenuDropdown
        anchorEl={anchor}
        onClose={onClose}
        items={items}
        search={search}
        onSearchChange={onSearchChange}
        searchPlaceholder={copy.searchPlaceholder}
        isLoading={isFetching}
        emptyMessage={copy.emptyMessage}
      />
    </>
  );
}
