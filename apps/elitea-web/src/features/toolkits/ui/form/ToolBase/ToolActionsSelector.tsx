import type { ReactNode } from 'react';
import { useCallback, useMemo } from 'react';

import Box from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { BasicAccordion } from '@/shared/ui/BasicAccordion';
import { t } from '@/shared/i18n';

import { EmptyMcpTools } from './EmptyMcpTools';
import { ToolActionsItems, type ToolActionOption } from './ToolActionsItems';

/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/toolkits/ui/form/
 * ToolBase/ToolActionsSelector.jsx` (197 lines) — the "Tools" section: a
 * chip picker over `availableTools`, optionally wrapped in an accordion,
 * optionally preceded by a "Load Tools" action for MCP/pre-built-MCP
 * toolkits.
 *
 * **DISCLOSED REDESIGN, two independent reasons:**
 *  1. **No ambient form context.** The baseline reads `values.settings.
 *     selected_tools` via `useFormikContext()`. This app has no Formik
 *     (`types.ts`'s own doc comment on `editField`) — `selectedTools` is a
 *     plain prop instead.
 *  2. **`no-sideways-features`, no carve-out.** The baseline's own
 *     `useGetRemoteMcpTools` (MCP tool-fetch orchestration + its "Load
 *     Tools" loading state) and `McpAuthModal` both live in `features/mcp`
 *     (this app: `features/mcps`) — a DIFFERENT `features/` slice from
 *     `features/toolkits`. Rather than reaching across that forbidden
 *     boundary, the fetch trigger/loading state/auth-modal become caller-
 *     injected: `onLoadTools`/`isLoadingTools`/`mcpAuthModal`. The real
 *     `useGetRemoteMcpTools()` call and `<McpAuthModal {...modalProps} />`
 *     render move to whichever `pages/`/`widgets/` composition layer
 *     ultimately mounts this component (legally allowed to import BOTH
 *     `features/toolkits` and `features/mcps`, per the layer model, §3.2) —
 *     this component keeps exactly its own baseline logic: which chips are
 *     selected/warning, the accordion vs. flat layout, and the button's
 *     enabled/label state (still computed here from `canLoadTools`, the
 *     pure boolean the baseline derived as `canGetRemoteMcpTools ||
 *     canGetPreconfiguredMcpTools`).
 *
 * `shouldUseAccordionView` (baseline: `useToolkitView()`, a route-matching
 * hook reading `react-router-dom`'s `useSearchParams`/a `RouteDefinitions`
 * table this app's router does not have) is a caller-supplied prop for the
 * same reason `ToolBase.tsx`'s own doc comment gives: a `features/`
 * component should not own route-derived presentation state, and no
 * promoted or intra-slice source for it exists.
 */
export interface ToolActionsSelectorProps {
  readonly availableTools: readonly (string | ToolActionOption)[];
  readonly onChange: (value: readonly string[]) => void;
  readonly selectedTools?: readonly string[] | undefined;
  readonly extraProperties?: ReactNode;
  readonly disabled?: boolean | undefined;
  readonly isRemoteMcp?: boolean | undefined;
  readonly isPreconfiguredMcp?: boolean | undefined;
  readonly onLoadTools?: (() => void) | undefined;
  readonly isLoadingTools?: boolean | undefined;
  readonly canLoadTools?: boolean | undefined;
  readonly mcpAuthModal?: ReactNode;
  readonly shouldUseAccordionView?: boolean | undefined;
}

function toOption(tool: string | ToolActionOption): ToolActionOption {
  if (typeof tool !== 'string') return tool;
  return { label: (tool.charAt(0).toUpperCase() + tool.slice(1)).replaceAll('_', ' '), value: tool };
}

interface LoadToolsActionProps {
  readonly canLoadTools: boolean;
  readonly isLoadingTools: boolean;
  readonly onLoadTools: (() => void) | undefined;
}

/** The accordion summary's "Load Tools" action — split out of `ToolActionsSelector` to keep that function under the §3.5 complexity budget. */
function LoadToolsAction({ canLoadTools, isLoadingTools, onLoadTools }: LoadToolsActionProps): ReactNode {
  const onClick = useCallback(() => {
    if (canLoadTools) onLoadTools?.();
  }, [canLoadTools, onLoadTools]);
  const label = isLoadingTools
    ? t('features.toolkits.toolBase.toolActionsSelector.loading', 'Loading...')
    : t('features.toolkits.toolBase.toolActionsSelector.loadTools', 'Load Tools');

  return (
    <Typography
      variant="labelSmall"
      // A real `<button>`/`Box component="button"` cannot go here: this
      // renders inside `StyledAccordionSummary`, which is itself a
      // `<button>` (`BasicAccordion`'s own `AccordionItem.summaryAction`
      // doc comment: "must not itself be (or contain) a literal
      // `<button>` — nested `<button>`s are invalid HTML. Use a non-button
      // interactive element instead... a `role="button"` element").
      component="span"
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- see comment above; a real <button> here would be invalid HTML (nested inside StyledAccordionSummary's own <button>).
      role="button"
      tabIndex={0}
      sx={loadToolsButtonSx(!canLoadTools || isLoadingTools)}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onClick();
      }}
    >
      {label}
    </Typography>
  );
}

interface ToolsSectionContentProps {
  readonly isMcpLike: boolean;
  readonly extraProperties: ReactNode;
  readonly hasNoTools: boolean;
  readonly items: ReactNode;
}

/** The accordion/flat body — split out of `ToolActionsSelector` for the same complexity-budget reason as `LoadToolsAction`. */
function ToolsSectionContent({ isMcpLike, extraProperties, hasNoTools, items }: ToolsSectionContentProps): ReactNode {
  return (
    <>
      {!isMcpLike && extraProperties}
      {isMcpLike && hasNoTools && <EmptyMcpTools />}
      {items}
    </>
  );
}

export function ToolActionsSelector({
  availableTools,
  onChange,
  selectedTools = [],
  extraProperties,
  disabled,
  isRemoteMcp = false,
  isPreconfiguredMcp = false,
  onLoadTools,
  isLoadingTools = false,
  canLoadTools = false,
  mcpAuthModal,
  shouldUseAccordionView = true,
}: ToolActionsSelectorProps): ReactNode {
  const toolsOptions = useMemo(() => availableTools.map(toOption), [availableTools]);
  const toolsOptionsValues = useMemo(() => toolsOptions.map((option) => option.value), [toolsOptions]);
  const warningTools = useMemo(
    () => selectedTools.filter((tool) => !toolsOptionsValues.includes(tool)),
    [selectedTools, toolsOptionsValues],
  );

  const onSelectTool = useCallback(
    (value: string) => () => {
      const isSelected = !selectedTools.includes(value);
      const next = isSelected ? [...selectedTools, value] : selectedTools.filter((item) => item !== value);
      onChange(next);
    },
    [selectedTools, onChange],
  );

  const isMcpLike = isRemoteMcp || isPreconfiguredMcp;
  const items = (
    <ToolActionsItems
      toolsOptions={toolsOptions}
      warningTools={warningTools}
      selectedTools={selectedTools}
      onSelectTool={onSelectTool}
      disabled={disabled}
    />
  );
  const content = (
    <ToolsSectionContent
      isMcpLike={isMcpLike}
      extraProperties={extraProperties}
      hasNoTools={availableTools.length === 0}
      items={items}
    />
  );

  if (!shouldUseAccordionView) {
    return (
      <Box sx={containerSx(false)}>
        <Typography variant="bodyMedium">{t('features.toolkits.toolBase.toolActionsSelector.title', 'Tools')}</Typography>
        {items}
        {mcpAuthModal}
      </Box>
    );
  }

  return (
    <Box sx={containerSx(true)}>
      <BasicAccordion
        items={[
          {
            title: t('features.toolkits.toolBase.toolActionsSelector.title', 'Tools'),
            summaryAction: isMcpLike ? (
              <LoadToolsAction
                canLoadTools={canLoadTools}
                isLoadingTools={isLoadingTools}
                onLoadTools={onLoadTools}
              />
            ) : null,
            content,
          },
        ]}
        slotSx={{ summary: { paddingRight: 0 } }}
      />
      {mcpAuthModal}
    </Box>
  );
}

function containerSx(shouldUseAccordionView: boolean) {
  return { marginTop: '1rem', padding: shouldUseAccordionView ? undefined : '0 0 0 0.75rem' };
}

function loadToolsButtonSx(disabled: boolean) {
  return (theme: Theme) => ({
    display: 'inline-block',
    color: !disabled ? theme.vars.palette.text.secondary : theme.vars.palette.text.button.disabled,
    cursor: !disabled ? 'pointer' : 'default',
    height: '1.75rem',
    boxSizing: 'border-box' as const,
    padding: theme.spacing(0.75, 2),
    borderRadius: theme.vars.shape.radiusPill ?? 9999,
    backgroundColor: theme.vars.palette.background.button.secondary.default,
    transition: theme.transitions.create('all'),
    userSelect: 'none' as const,
    '&:hover': {
      backgroundColor: !disabled ? theme.vars.palette.background.button.secondary.hover : undefined,
    },
    '&:active': { transform: 'scale(0.98)' },
  });
}
