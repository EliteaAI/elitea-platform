/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/pipelines/flow-editor/ui/
 * state/StateDrawer.jsx` (215 lines) — unit A2j. The flow editor's
 * right-hand State drawer: header + `StateVariableList` body, resizable via
 * the already-landed A2d `useResizableDrawer` hook, with the
 * add/update/delete/toggle state-mutation handlers that drive
 * `yamlJsonObject.state`.
 *
 * `CloseIcon` (baseline: `@/components/Icons/CloseIcon`, a custom SVG) ->
 * `@mui/icons-material/Close`, the same already-established substitute
 * `shared/ui/BaseModal.tsx`/`shared/ui/ExpandedViewerModal.tsx` use for the
 * identical gap. `IconButton` `variant="elitea"` is dropped, same reasoning
 * as `./StateVariableIconButton.tsx`. All `borderRadius`/ad-hoc-`fontSize`
 * concerns from the baseline's own `stateDrawerStyles` do not apply here —
 * this file has neither.
 */
import type { ReactNode } from 'react';
import { useCallback } from 'react';

import CloseIcon from '@mui/icons-material/Close';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { FlowEditorConstants } from '../../lib/flow-editor/constants';
import { getDefaultValueForType } from '../../lib/flow-editor/helpers/state.helpers';
import { useResizableDrawer } from '../../lib/flow-editor/hooks/useResizableDrawer';
import type { YamlPipelineDocument } from '../../lib/flow-editor/helpers/pipelineFlow.types';
import { ClipboardIcon } from '@/shared/ui/icons/clipboard-icon';
import { t } from '@/shared/i18n';

import { StateVariableList, type StateVariableConfig } from './StateVariableList';

/** @public */
export interface StateDrawerProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly setYamlJsonObject: (document: YamlPipelineDocument) => void;
  readonly yamlJsonObject: YamlPipelineDocument;
  readonly disabled?: boolean | undefined;
}

type StateMap = Readonly<Record<string, StateVariableConfig>>;

/**
 * `YamlPipelineDocument['state']`'s declared type additionally allows a
 * legacy bare-string spec (`YamlStateVariableSpec | string`, see that
 * file's own doc comment) for old, pre-migration YAML. The baseline (an
 * untyped `.jsx` file) always read `state[name].type`/`.value` directly,
 * i.e. always assumed the `{ type, value }` object shape at this call site
 * too — matched here with a narrowing cast, not a runtime normalization
 * this component was never responsible for in the baseline either.
 */
function stateOf(document: YamlPipelineDocument): StateMap {
  return (document.state as StateMap | undefined) ?? {};
}

export function StateDrawer(props: StateDrawerProps): ReactNode {
  const { isOpen, onClose, setYamlJsonObject, yamlJsonObject, disabled } = props;

  const { containerRef, drawerWidth, isResizing, isHoveringHandle, setIsHoveringHandle, handleResizeStart } =
    useResizableDrawer();

  const handleToggleState = useCallback(
    (name: string, enabled: boolean) => {
      const oldState = yamlJsonObject.state ? stateOf(yamlJsonObject) : { ...FlowEditorConstants.DefaultState };
      let newState: Record<string, StateVariableConfig>;
      if (enabled) {
        newState = {
          ...oldState,
          [name]: {
            type:
              name === FlowEditorConstants.STATE_MESSAGES
                ? FlowEditorConstants.StateVariableTypes.List
                : FlowEditorConstants.StateVariableTypes.String,
          },
        };
      } else {
        newState = { ...oldState };
        delete newState[name];
      }
      setYamlJsonObject({ ...yamlJsonObject, state: newState });
    },
    [setYamlJsonObject, yamlJsonObject],
  );

  const handleUpdateState = useCallback(
    (name: string, changes: Readonly<Record<string, unknown>>) => {
      const updated: Record<string, StateVariableConfig> = { ...stateOf(yamlJsonObject) };
      const newName = changes['newName'];
      if (typeof newName === 'string' && newName !== name) {
        updated[newName] = { ...updated[name] };
        delete updated[name];
      } else {
        updated[name] = { ...updated[name], ...changes };
      }
      setYamlJsonObject({ ...yamlJsonObject, state: updated });
    },
    [setYamlJsonObject, yamlJsonObject],
  );

  const handleDeleteState = useCallback(
    (name: string) => {
      const newState = { ...stateOf(yamlJsonObject) };
      delete newState[name];
      setYamlJsonObject({ ...yamlJsonObject, state: newState });
    },
    [setYamlJsonObject, yamlJsonObject],
  );

  const handleAddState = useCallback(
    (name: string, type = 'str'): boolean => {
      if (!name) return false;
      const currentState = yamlJsonObject.state ? stateOf(yamlJsonObject) : undefined;
      if (currentState?.[name]) return false;
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) return false;
      const updated: Record<string, StateVariableConfig> = {
        ...(currentState ?? FlowEditorConstants.DefaultState),
      };
      updated[name] = { type, value: getDefaultValueForType(type) };
      setYamlJsonObject({ ...yamlJsonObject, state: updated });
      return true;
    },
    [setYamlJsonObject, yamlJsonObject],
  );

  if (!isOpen) return null;

  return (
    <Box
      ref={containerRef}
      sx={containerSx(drawerWidth, isResizing, isHoveringHandle)}
    >
      <Box
        sx={resizeHandleSx}
        onMouseDown={handleResizeStart}
        onMouseEnter={() => setIsHoveringHandle(true)}
        onMouseLeave={() => setIsHoveringHandle(false)}
      />
      <Box sx={headerSx}>
        <Box sx={headerContentSx}>
          <Box sx={headerIconSx}>
            <ClipboardIcon />
          </Box>
          <Typography
            variant="labelSmall"
            sx={headerTitleSx}
          >
            {t('pipelines.flowEditor.state.drawerTitle', 'STATE')}
          </Typography>
        </Box>
        <IconButton
          aria-label={t('pipelines.flowEditor.state.closeDrawer', 'Close')}
          onClick={onClose}
          sx={closeButtonSx}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      <Box sx={contentSx}>
        <StateVariableList
          states={yamlJsonObject.state as StateMap | undefined}
          drawerWidth={drawerWidth}
          onUpdateState={handleUpdateState}
          onDeleteState={handleDeleteState}
          onToggleState={handleToggleState}
          onAddState={handleAddState}
          disabled={disabled}
        />
      </Box>
    </Box>
  );
}

function containerSx(width: number, isResizing: boolean, isHovering: boolean): SxProps<Theme> {
  return (theme: Theme) => ({
    position: 'absolute',
    top: 0,
    right: 0,
    width: `${width}px`,
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    borderLeft: `.0625rem solid ${
      isResizing ? theme.vars.palette.primary.pressed : isHovering ? theme.vars.palette.border.flowNode : theme.vars.palette.border.lines
    }`,
    background: theme.vars.palette.background.secondary,
    zIndex: 10,
    transition: isResizing ? 'none' : 'border-color 0.2s ease',
  });
}

const resizeHandleSx: SxProps<Theme> = {
  position: 'absolute',
  left: '-0.25rem',
  top: 0,
  width: '.5rem',
  height: '100%',
  cursor: 'ew-resize',
  zIndex: 11,
};

const headerSx: SxProps<Theme> = (theme: Theme) => ({
  height: theme.spacing(5.5),
  padding: `${theme.spacing(1)} ${theme.spacing(1.5)} ${theme.spacing(1)} ${theme.spacing(2)}`,
  width: '100%',
  borderBottom: `.0625rem solid ${theme.vars.palette.border.lines}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
});

const headerContentSx: SxProps<Theme> = (theme: Theme) => ({
  display: 'flex',
  alignItems: 'center',
  gap: theme.spacing(0.8),
});

const headerIconSx: SxProps<Theme> = (theme: Theme) => ({
  display: 'flex',
  alignItems: 'center',
  color: theme.vars.palette.icon.fill.secondary,
});

const headerTitleSx: SxProps<Theme> = (theme: Theme) => ({
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: theme.vars.palette.text.primary,
});

const closeButtonSx: SxProps<Theme> = (theme: Theme) => ({
  marginLeft: 0,
  padding: theme.spacing(1),
  color: theme.vars.palette.icon.fill.default,
});

const contentSx: SxProps<Theme> = (theme: Theme) => ({
  overflow: 'auto',
  display: 'flex',
  flexDirection: 'column',
  paddingInline: theme.spacing(2),
  paddingTop: theme.spacing(2),
  paddingBottom: theme.spacing(2),
  boxSizing: 'border-box',
  width: '100%',
  flex: 1,
  gap: theme.spacing(2),
});
