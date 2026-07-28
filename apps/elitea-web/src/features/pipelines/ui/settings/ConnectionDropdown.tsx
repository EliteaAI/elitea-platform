/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * settings/ConnectionDropdown.jsx` (337 lines) — unit A2k. The "drag a
 * connection and drop it on empty canvas" popup: either pick one of the
 * `targetNodes` already on the canvas, or fall through to a node-type grid
 * to create a brand-new node. Grouped under this sub-unit (not "settings",
 * its baseline directory) because its real consumers are `FlowEditor.tsx`
 * itself and A2d's `useIncompleteEdge.ts` — it is the incomplete-edge-drag
 * popup, not a node-config settings panel.
 *
 * DEVIATIONS:
 *  - `capitalizeFirstChar` (baseline: `@/common/utils`) -> `@/shared/lib/
 *    string`; `PlusIcon` (baseline: `@/components/Icons/PlusIcon`) ->
 *    `@/shared/ui/icons/plus-icon` (Wave-1 unit S2/S3 ports of the same
 *    utilities, same import-path swap every other sub-unit in this batch
 *    makes).
 *  - `borderRadius: '0.75rem'` / `'0.625rem'` -> `theme.vars.shape.
 *    radiusMd` (R-T10 — ad-hoc radii are banned; `0.75rem` maps to
 *    `radiusMd`, same mapping `AIPromptInput.tsx`'s own doc comment
 *    already established for the identical baseline literal).
 *  - `boxShadow: '0 1rem 2rem rgba(3, 12, 28, 0.35)'` (baseline: a raw rgba
 *    literal) -> `theme.vars.palette.boxShadow.default` (R-T1 bans raw
 *    colour literals outside `shared/brand/tokens/`).
 *  - `theme.palette.*` -> `theme.vars.palette.*` throughout (R-T7).
 */
import type { ReactNode } from 'react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';

import Box from '@mui/material/Box';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useTheme, type SxProps, type Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { capitalizeFirstChar } from '@/shared/lib/string';
import { t } from '@/shared/i18n';
import { PlusIcon } from '@/shared/ui/icons/plus-icon';

import { DeprecatedConstants, FlowEditorConstants } from '../../lib/flow-editor/constants';
import { getNodeIconByType } from '../../lib/flow-editor/helpers/node.helpers';
import type { FlowNode } from '../../lib/flow-editor/reactFlowTypes';

/** @public This sub-unit's own composition — not re-exported from this slice's `index.ts` (canvas-internal popup, not a public surface). */
export interface ConnectionDropdownProps {
  readonly open: boolean;
  readonly anchorPosition: { readonly x: number; readonly y: number } | null;
  readonly anchorEl?: Element | null | undefined;
  readonly targetNodes: readonly FlowNode[] | undefined;
  readonly availableNodeTypes?: readonly string[] | undefined;
  readonly onNodeSelect: (node: { readonly id: string }) => void;
  readonly onNodeCreate: (nodeType: string) => void;
  readonly onClose: () => void;
  readonly forceNodeCreation?: boolean;
}

interface NodeCreationMenuItem {
  readonly label: string;
  readonly type: string;
  readonly icon: ReactNode;
}

/** `ConnectionDropdown.jsx:45-65`'s `nodeCreationMenuItems` derivation, split out to keep the component body under §3.5's complexity budget. */
function buildNodeCreationMenuItems(availableNodeTypes: readonly string[] | undefined, theme: Theme): readonly NodeCreationMenuItem[] {
  const nodeTypesToShow =
    availableNodeTypes?.filter(nodeType => !DeprecatedConstants.DeprecatedNodes.includes(nodeType)) ??
    Object.keys(FlowEditorConstants.PipelineNodeTypes)
      .sort()
      .filter(key => !DeprecatedConstants.DeprecatedOrInvisibleNode.includes(key))
      .map(key => FlowEditorConstants.PipelineNodeTypes[key as keyof typeof FlowEditorConstants.PipelineNodeTypes]);

  return nodeTypesToShow
    .map(nodeType => ({
      label:
        FlowEditorConstants.PipelineNodeDisplayNames[nodeType as keyof typeof FlowEditorConstants.PipelineNodeDisplayNames] ??
        capitalizeFirstChar(nodeType.split('_').join(' ')),
      type: nodeType,
      icon: getNodeIconByType(nodeType, theme, theme.vars.palette.icon.fill.secondary),
    }))
    .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
}

/**
 * Every function-valued entry below is typed via `satisfies SxProps<Theme>`
 * on the FUNCTION ITSELF, not an inline `(theme: Theme): SxProps<Theme> =>`
 * return-type annotation — the latter makes the property's inferred type
 * `(theme: Theme) => SxProps<Theme>`, which is NOT assignable to
 * `SxProps<Theme>`'s own function arm (`(theme: Theme) =>
 * SystemStyleObject<Theme>`, a narrower, non-recursive return type) and
 * fails at every real `sx={connectionDropdownStyles.x}` call site below
 * with an opaque "no overload matches this call". `satisfies` checks the
 * function's assignability to `SxProps<Theme>` without widening its
 * inferred type the same way a `: SxProps<Theme>` annotation would.
 */
const connectionDropdownStyles = {
  menuPaper: ((theme: Theme) => ({
    maxHeight: '18.75rem',
    minWidth: '12.5rem',
    maxWidth: '21.875rem',
    borderRadius: theme.vars.shape.radiusMd,
    border: `0.0625rem solid ${theme.vars.palette.border.lines}`,
    boxShadow: theme.vars.palette.boxShadow.default,
    background: theme.vars.palette.background.secondary,
    padding: 0,
    marginTop: '0.5rem',
  })) satisfies SxProps<Theme>,
  gridMenuPaper: ((theme: Theme) => ({
    maxHeight: '18.75rem',
    minWidth: '27.25rem',
    maxWidth: '27.25rem',
    borderRadius: theme.vars.shape.radiusMd,
    border: `0.0625rem solid ${theme.vars.palette.border.lines}`,
    boxShadow: theme.vars.palette.boxShadow.default,
    background: theme.vars.palette.background.secondary,
    padding: '0.5rem 0.75rem',
    marginTop: '0.625rem',
    overflow: 'hidden',
  })) satisfies SxProps<Theme>,
  /**
   * The baseline targets `.MuiMenu-list` with a raw `'& .MuiMenu-list'`
   * selector (an internal Emotion-generated class) to turn the two-column
   * grid into a row layout. R-T6 bans reaching into internal MUI/Emotion
   * class selectors from app code (overrides belong in `shared/brand/
   * mui-overrides/`, one file per component key — this ISN'T a
   * `MuiMenu`-wide override, just this one popup's grid mode). MUI's
   * `Menu` exposes the underlying `MenuList` directly as a styleable slot
   * (`slotProps.list.sx`) for exactly this — used at the `<Menu>` call site
   * below instead of a selector hack.
   */
  gridMenuList: { display: 'flex', flexDirection: 'row', padding: 0 } satisfies SxProps<Theme>,
  gridColumn: { display: 'flex', flexDirection: 'column', flex: 1 } satisfies SxProps<Theme>,
  menuItem: { minHeight: '2.5rem' } satisfies SxProps<Theme>,
  addNewNodeItem: ((theme: Theme) => ({
    minHeight: '2.5rem',
    borderBottom: `0.0625rem solid ${theme.vars.palette.border.lines}`,
  })) satisfies SxProps<Theme>,
  addNewNodeItemWithoutBorder: { minHeight: '2.5rem' } satisfies SxProps<Theme>,
  listItemIcon: { minWidth: '1.5rem', maxWidth: '1.5rem' } satisfies SxProps<Theme>,
  listItemTextPrimary: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '17.5rem',
  } satisfies SxProps<Theme>,
  gridListItemIcon: ((theme: Theme) => ({
    minWidth: '1.5rem',
    maxWidth: '1.5rem',
    color: theme.vars.palette.icon.fill.secondary,
    '& svg': { width: '1rem', height: '1rem', display: 'block' },
  })) satisfies SxProps<Theme>,
  gridMenuItem: ((theme: Theme) => ({
    minHeight: '3rem',
    borderRadius: theme.vars.shape.radiusMd,
    gap: '0.5rem',
    '&:hover': { backgroundColor: theme.vars.palette.background.conversation.hover },
  })) satisfies SxProps<Theme>,
  gridListItemTextPrimary: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: '10.25rem',
  } satisfies SxProps<Theme>,
} as const;

interface NodeCreationGridProps {
  readonly items: readonly NodeCreationMenuItem[];
  readonly onSelect: (nodeType: string) => void;
}

/** One column of `ConnectionDropdown.jsx:143-201`'s two-column node-type grid — split out purely to avoid duplicating the `MenuItem` JSX for each half. */
function NodeCreationColumn({ items, onSelect }: NodeCreationGridProps): ReactNode {
  return (
    <Box
      component="div"
      sx={connectionDropdownStyles.gridColumn}
    >
      {items.map(item => (
        <MenuItem
          key={item.type}
          onClick={() => onSelect(item.type)}
          sx={connectionDropdownStyles.gridMenuItem}
        >
          <ListItemIcon sx={connectionDropdownStyles.gridListItemIcon}>{item.icon}</ListItemIcon>
          <ListItemText
            primary={
              <Typography
                variant="bodyMedium"
                color="text.secondary"
                sx={connectionDropdownStyles.gridListItemTextPrimary}
              >
                {item.label}
              </Typography>
            }
          />
        </MenuItem>
      ))}
    </Box>
  );
}

/** The full two-column node-creation grid — split out of the main component purely to keep its own cyclomatic complexity under §3.5's budget of 12. */
function NodeCreationGrid({ items, onSelect }: NodeCreationGridProps): ReactNode {
  const midpoint = Math.ceil(items.length / 2);
  return (
    <>
      <NodeCreationColumn
        items={items.slice(0, midpoint)}
        onSelect={onSelect}
      />
      <NodeCreationColumn
        items={items.slice(midpoint)}
        onSelect={onSelect}
      />
    </>
  );
}

interface ExistingTargetsMenuProps {
  readonly targetNodes: readonly FlowNode[] | undefined;
  readonly theme: Theme;
  readonly onCreateNewNode: () => void;
  readonly onNodeSelect: (node: { readonly id: string } | undefined) => void;
}

/** The "pick an existing target, or create a new node" list — same complexity-budget reason as {@link NodeCreationGrid}. */
function ExistingTargetsMenu({ targetNodes, theme, onCreateNewNode, onNodeSelect }: ExistingTargetsMenuProps): ReactNode {
  return (
    <>
      <MenuItem
        onClick={onCreateNewNode}
        sx={targetNodes?.length ? connectionDropdownStyles.addNewNodeItem : connectionDropdownStyles.addNewNodeItemWithoutBorder}
      >
        <ListItemIcon sx={connectionDropdownStyles.listItemIcon}>
          <PlusIcon fill={theme.vars.palette.icon.fill.default} />
        </ListItemIcon>
        <ListItemText
          primary={
            <Typography
              variant="bodyMedium"
              color="text.secondary"
              sx={connectionDropdownStyles.listItemTextPrimary}
            >
              {t('pipelines.flowEditor.connectionDropdown.createNewNode', 'Create new node')}
            </Typography>
          }
        />
      </MenuItem>
      {targetNodes?.map(node => (
        <MenuItem
          key={node.id}
          onClick={() => onNodeSelect(node)}
          sx={connectionDropdownStyles.menuItem}
        >
          <ListItemIcon sx={connectionDropdownStyles.listItemIcon}>
            {getNodeIconByType(node.type ?? '', theme, theme.vars.palette.icon.fill.default)}
          </ListItemIcon>
          <ListItemText
            primary={
              <Typography
                variant="bodyMedium"
                color="text.secondary"
                sx={connectionDropdownStyles.listItemTextPrimary}
              >
                {node.data?.label ?? node.id}
              </Typography>
            }
          />
        </MenuItem>
      ))}
    </>
  );
}

type MenuAnchorProps =
  | { readonly anchorEl: Element; readonly anchorOrigin: { vertical: 'bottom'; horizontal: 'center' }; readonly transformOrigin: { vertical: 'top'; horizontal: 'center' } }
  | {
      readonly anchorReference: 'anchorPosition';
      readonly anchorPosition: { readonly top: number; readonly left: number };
      readonly anchorOrigin: { vertical: 'bottom'; horizontal: 'left' };
      readonly transformOrigin: { vertical: 'top'; horizontal: 'left' };
    };

/** `ConnectionDropdown.jsx:102-128`'s anchor-prop switch — MUI `Menu` positions either off a real anchor element or a bare `{x,y}` position, split out purely to keep the component's own complexity under budget. */
function buildMenuAnchorProps(anchorPosition: { readonly x: number; readonly y: number } | null, anchorEl: Element | null | undefined): MenuAnchorProps {
  if (anchorEl) {
    return { anchorEl, anchorOrigin: { vertical: 'bottom', horizontal: 'center' }, transformOrigin: { vertical: 'top', horizontal: 'center' } };
  }
  return {
    anchorReference: 'anchorPosition',
    anchorPosition: { top: anchorPosition?.y ?? 0, left: anchorPosition?.x ?? 0 },
    anchorOrigin: { vertical: 'bottom', horizontal: 'left' },
    transformOrigin: { vertical: 'top', horizontal: 'left' },
  };
}

export const ConnectionDropdown = memo(function ConnectionDropdown(props: ConnectionDropdownProps): ReactNode {
  const { open, anchorPosition, anchorEl, targetNodes, availableNodeTypes, onNodeSelect, onNodeCreate, onClose, forceNodeCreation = false } = props;
  const [showNodeCreation, setShowNodeCreation] = useState(false);
  const theme = useTheme();

  useEffect(() => {
    if (!open) {
      setShowNodeCreation(false);
      return;
    }
    if (forceNodeCreation) {
      setShowNodeCreation(true);
      return;
    }
    // When there are no existing targets, open directly into the node grid.
    setShowNodeCreation(!targetNodes?.length);
  }, [forceNodeCreation, open, targetNodes]);

  const nodeCreationMenuItems = useMemo(() => buildNodeCreationMenuItems(availableNodeTypes, theme), [theme, availableNodeTypes]);

  const handleClose = useCallback(() => {
    setShowNodeCreation(false);
    onClose();
  }, [onClose]);

  const handleNodeSelect = useCallback(
    (node: { readonly id: string } | undefined) => {
      if (node) {
        onNodeSelect(node);
        handleClose();
      }
    },
    [handleClose, onNodeSelect],
  );

  const handleCreateNewNode = useCallback(() => {
    setShowNodeCreation(true);
  }, []);

  const handleNodeTypeSelect = useCallback(
    (nodeType: string) => {
      onNodeCreate(nodeType);
      handleClose();
    },
    [handleClose, onNodeCreate],
  );

  if (!open || (!anchorPosition && !anchorEl)) {
    return null;
  }

  return (
    <Menu
      open={open}
      onClose={handleClose}
      {...buildMenuAnchorProps(anchorPosition, anchorEl)}
      slotProps={{
        paper: { sx: showNodeCreation ? connectionDropdownStyles.gridMenuPaper : connectionDropdownStyles.menuPaper },
        list: showNodeCreation ? { sx: connectionDropdownStyles.gridMenuList } : {},
      }}
    >
      {showNodeCreation ? (
        <NodeCreationGrid
          items={nodeCreationMenuItems}
          onSelect={handleNodeTypeSelect}
        />
      ) : (
        <ExistingTargetsMenu
          targetNodes={targetNodes}
          theme={theme}
          onCreateNewNode={handleCreateNewNode}
          onNodeSelect={handleNodeSelect}
        />
      )}
    </Menu>
  );
});
