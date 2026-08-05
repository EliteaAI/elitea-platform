import { type ReactNode, useCallback, useMemo } from 'react';

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Tooltip from '@mui/material/Tooltip';

import { t } from '@/shared/i18n';
import { BaseBtn } from '@/shared/ui/BaseBtn';
import { DiscardButton } from '@/shared/ui/DiscardButton';

const MCP_PREBUILD_PREFIX = 'mcp_';

/**
 * Local duplicate of `McpAuthHelpers.isPrebuildMcpType`
 * (`features/mcp/lib/helpers/mcpAuth.helpers.js:38-44`, baseline) — a
 * one-line predicate (pre-built MCP toolkit types are prefixed `mcp_` but
 * the bare `'mcp'` type itself means "remote MCP", not pre-built). Not
 * imported: `features/toolkits` cannot import `features/mcps`
 * (`no-sideways-features`), same class of duplication this batch's mission
 * preamble flags for `useGetToolkitNameFromSchema`/`useToolMenuItems`.
 */
export function isPrebuildMcpType(toolkitType: string | undefined): boolean {
  return typeof toolkitType === 'string' && toolkitType.startsWith(MCP_PREBUILD_PREFIX) && toolkitType !== 'mcp';
}

/** @public */
export interface CreateToolkitToolTabBarProps {
  readonly toolkitType: string | undefined;
  readonly isDirty: boolean;
  readonly isSaving: boolean;
  readonly hasNotSavedCredentials?: boolean;
  readonly isMCP?: boolean;
  readonly isApplication?: boolean;
  readonly onSave: () => void;
  readonly onClearEditTool: () => void;
}

/**
 * Ported from `apps/elitea-ui/src/pages/Toolkits/CreateToolkitToolTabBar.jsx`
 * (209 lines).
 *
 * MAJOR DISCLOSED REDESIGN. The baseline is a save/cancel bar that
 * communicates with its OWN parent-mounted `ToolkitForm` purely through a
 * global `eventEmitter` (`ToolEvents.ToolkitsCreateToolkit`/
 * `ToolkitsCreateToolkitWithConfiguration` fired on save-click,
 * `ToolEvents.SaveEvent` listened for the actual submit trigger,
 * `useCreateToolkit(formik)` — an ambient Formik-context RTK-Query wrapper
 * — doing the real network call) plus `react-router-dom`
 * navigation-on-success (to the toolkit/MCP/app detail route, OR back to a
 * `SearchParams.ReturnUrl` source application with
 * `SearchParams.SourceApplicationId`/`newToolkitId` query params wired for
 * auto-association) and `useNavBlocker` (Redux nav-blocking-while-dirty).
 * None of this app has: no Formik, no global event bus (`common/
 * eventEmitter`, no port anywhere in this worktree), no generated
 * create-toolkit endpoint (see `../api/toolkits.ts`'s module doc comment),
 * and nav-blocking is a `widgets/`-owned store `features/` cannot reach
 * (`useEditToolkit.ts`'s own doc comment, this same unit).
 *
 * This port keeps ONLY the real, reachable orchestration: a Save button
 * (disabled while `!isDirty`/`isSaving`, with a credential-aware tooltip)
 * and a Discard/Cancel button — both plain callback props
 * (`onSave`/`onClearEditTool`), matching the "props not ambient context/
 * event-bus" convention this whole batch already established
 * (`AgentEditor.tsx`'s own doc comment). The caller (a page composing this
 * bar alongside its own `ToolkitForm`/`CreateToolkitButton`-equivalent
 * network call) owns:
 *  - The actual save trigger and its network call (this bar has no
 *    endpoint to call itself — see `../api/toolkits.ts`).
 *  - Post-save navigation, including the baseline's
 *    return-to-source-application flow (`SearchParams.ReturnUrl`/
 *    `SourceApplicationId`) — router/page-layer concern, not this bar's.
 *  - GA event tracking (`MCP_CREATED`/`APPLICATION_CREATED`/
 *    `TOOLKIT_CREATED`) — dropped outright, same documented gap this
 *    session's other editors give (no analytics-event SDK exists).
 *
 * `isPrebuildMcpType` is kept (a real, cheap, self-contained predicate) even
 * though this port's own save/navigation flow no longer needs it directly —
 * it is exported for whatever future page composes this bar's
 * `onSave`/post-save navigation and needs the SAME pre-built-vs-remote-MCP
 * distinction the baseline's own destination-route branch used.
 */
export function CreateToolkitToolTabBar({
  toolkitType,
  isDirty,
  isSaving,
  hasNotSavedCredentials = false,
  isMCP = false,
  isApplication = false,
  onSave,
  onClearEditTool,
}: CreateToolkitToolTabBarProps): ReactNode {
  const shouldDisableSave = useMemo(() => isSaving || !isDirty || toolkitType === undefined, [isSaving, isDirty, toolkitType]);

  const tooltipTitle = hasNotSavedCredentials
    ? t('toolkits.createToolkitToolTabBar.saveCredentials', 'Save credentials')
    : t('toolkits.createToolkitToolTabBar.saveToolkit', 'Save toolkit');

  const cancelLabel = isMCP
    ? t('toolkits.createToolkitToolTabBar.cancelMcp', 'Are you sure you want to cancel creation of this MCP?')
    : isApplication
      ? t('toolkits.createToolkitToolTabBar.cancelApplication', 'Are you sure you want to cancel creation of this application?')
      : t('toolkits.createToolkitToolTabBar.cancelToolkit', 'Are you sure you want to cancel creation of this toolkit?');

  const handleSave = useCallback(() => {
    if (!shouldDisableSave) onSave();
  }, [shouldDisableSave, onSave]);

  return (
    <Box sx={containerSx}>
      <Tooltip title={tooltipTitle}>
        <Box component="span">
          <BaseBtn
            variant="elitea"
            color="primary"
            disabled={shouldDisableSave}
            onClick={handleSave}
          >
            {hasNotSavedCredentials ? t('toolkits.createToolkitToolTabBar.saveCredentialsLabel', 'Save Credentials') : t('toolkits.createToolkitToolTabBar.saveLabel', 'Save')}
            {isSaving && <CircularProgress size={20} />}
          </BaseBtn>
        </Box>
      </Tooltip>
      <DiscardButton
        title={t('toolkits.createToolkitToolTabBar.cancelTitle', 'Cancel')}
        disabled={isSaving}
        onDiscard={onClearEditTool}
        alertContent={cancelLabel}
      />
    </Box>
  );
}

const containerSx = { display: 'flex', alignItems: 'center', gap: '0.75rem' };
