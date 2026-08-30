/**
 * The per-node half of the graph-validation surface: every reason the native
 * pipeline runtime would refuse THIS node, named by the exact YAML field and
 * value that offends it.
 *
 * Rendered by `ui/nodes/BaseNode/NodeCard.tsx` — the one component every node
 * card in the editor goes through — so a new node family gets this for free
 * and none can quietly opt out. (`CommonInterruptSettings` was the obvious
 * alternative, but five node families do not render it.)
 *
 * The messages themselves come from `lib/graphAdmission.helpers.ts` and are
 * not translated: each embeds a YAML field name and a user-authored
 * identifier. The chrome around them is.
 */
import type { ReactNode } from 'react';

import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';

import type { GraphAdmissionIssue } from '../../lib/graphAdmission.types';
import { useNodeAdmissionIssues } from './useGraphAdmission';

export interface NodeAdmissionIssuesProps {
  readonly nodeId: string;
}

const alertSx: SxProps<Theme> = { width: '100%', boxSizing: 'border-box', alignItems: 'flex-start' };
const listSx: SxProps<Theme> = { margin: 0, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' };

/** Stable key for one issue — a node can hold several issues of the same rule on different fields. */
function issueKey(issue: GraphAdmissionIssue): string {
  return `${issue.rule}|${issue.field}|${issue.subject}`;
}

export function NodeAdmissionIssues({ nodeId }: NodeAdmissionIssuesProps): ReactNode {
  const issues = useNodeAdmissionIssues(nodeId);
  if (issues.length === 0) return null;

  return (
    <Alert
      severity="error"
      variant="outlined"
      sx={alertSx}
      data-testid="node-admission-issues"
    >
      <AlertTitle>{t('features.pipelines.nodeAdmissionIssues.title', 'This node stops the pipeline from running')}</AlertTitle>
      <Box
        component="ul"
        sx={listSx}
      >
        {issues.map((issue) => (
          <Typography
            key={issueKey(issue)}
            component="li"
            variant="bodySmall"
            title={issue.citation}
          >
            {issue.message}
          </Typography>
        ))}
      </Box>
    </Alert>
  );
}
