import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';
import { TypographyWithConditionalTooltip } from '@/shared/ui/TypographyWithConditionalTooltip';
import { AttachIcon } from '@/shared/ui/icons/attach-icon';

import type { AgentToolAssociation } from '../lib/types';

import { AgentPipelineVersionSelector } from './AgentPipelineVersionSelector';
import { BaseCardBody } from './BaseCardBody';
import { attachIconSx, attachmentButtonSx, contentBoxSx, titleRowSx, toolkitNameSx, variablesToggleCountSx, variablesToggleLabelSx, variablesToggleSx } from './ToolCard.styles';
import type { ToolCardVersionSelectorProps } from './ToolCard.types';

/**
 * `ToolCard`'s title row + body region, split out of `ToolCard.tsx` purely
 * to keep the `oxlint` `complexity` budget (≤12) — the JSX-embedded
 * conditionals this region owns (`isAgentOrPipeline && versionSelector`,
 * `hasVariables &&`, `!isAgentOrPipeline &&`) contributed directly to
 * `ToolCard`'s own function-body cyclomatic complexity when they lived
 * there (each `&&`/ternary in a function's OWN body counts toward it; a
 * JSX expression container is not a separate function scope, unlike a
 * `useMemo`/`useCallback` callback).
 */
export interface ToolCardBodyProps {
  readonly tool: AgentToolAssociation;
  readonly toolkitName: string;
  readonly isAttachmentToolkit: boolean;
  readonly isAgentOrPipeline: boolean;
  readonly versionSelector?: ToolCardVersionSelectorProps | undefined;
  readonly disabled?: boolean | undefined;
  readonly showVariables: boolean;
  readonly onToggleVariables: () => void;
  readonly showActions: boolean;
  readonly onClickShowActions: () => void;
}

export function ToolCardBody({ tool, toolkitName, isAttachmentToolkit, isAgentOrPipeline, versionSelector, disabled, showVariables, onToggleVariables, showActions, onClickShowActions }: ToolCardBodyProps): ReactNode {
  const hasVariables = (tool.variables?.length ?? 0) > 0;

  return (
    <Box sx={contentBoxSx(isAgentOrPipeline)}>
      <Box sx={titleRowSx}>
        <TypographyWithConditionalTooltip
          title={toolkitName}
          placement="right"
          variant="bodyMedium"
          color="text.secondary"
          sx={toolkitNameSx}
        >
          {toolkitName}
        </TypographyWithConditionalTooltip>
        {isAttachmentToolkit && (
          <IconButton
            color="tertiary"
            size="small"
            disabled
            sx={attachmentButtonSx}
          >
            <Box
              component={AttachIcon}
              sx={attachIconSx}
            />
          </IconButton>
        )}
      </Box>

      {isAgentOrPipeline && versionSelector && (
        <AgentPipelineVersionSelector
          applicationVersionId={tool.settings?.application_version_id}
          disabled={disabled}
          versions={versionSelector.versions}
          isRefreshingVersions={versionSelector.isRefreshingVersions}
          onRefreshVersions={versionSelector.onRefreshVersions}
          isSwitchingVersion={versionSelector.isSwitchingVersion}
          onSelectVersion={versionSelector.onSelectVersion}
        />
      )}

      {hasVariables && (
        <Box
          sx={variablesToggleSx}
          onClick={onToggleVariables}
        >
          <Typography
            component="span"
            variant="bodySmall2"
            sx={variablesToggleLabelSx}
          >
            {showVariables ? t('agents.toolCard.hideVariables', 'Hide variables') : t('agents.toolCard.showVariables', 'Show variables')}
          </Typography>
          <Typography
            component="span"
            variant="bodySmall2"
            sx={variablesToggleCountSx}
          >
            ({tool.variables?.length ?? 0})
          </Typography>
        </Box>
      )}

      {!isAgentOrPipeline && (
        <BaseCardBody
          tool={tool}
          onClickShowActions={onClickShowActions}
          showActions={showActions}
        />
      )}
    </Box>
  );
}
