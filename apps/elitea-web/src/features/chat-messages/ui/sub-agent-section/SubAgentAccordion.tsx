/**
 * Ported from `apps/elitea-ui/src/[fsd]/features/chat/ui/sub-agent-section/
 * SubAgentAccordion.jsx` — renders a sub-agent execution accordion with
 * grouped tool actions and live status indicator.
 *
 * Uses `partitionActionsIntoBlocks` from `../../lib/subAgentGrouping`
 * for grouping actions by sub-agent invocation.
 *
 * Port of `apps/elitea-ui/src/[fsd]/features/chat/ui/sub-agent-section/
 * SubAgentAccordion.jsx`.
 */
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { BasicAccordion } from '@/shared/ui/BasicAccordion';

import type { PartitionedBlock } from '../../lib/subAgentGrouping';

/** @public Props for `SubAgentAccordion`. */
export interface SubAgentAccordionProps {
  /** The partitioned sub-agent blocks to render. */
  readonly blocks: readonly PartitionedBlock[];
  /** Whether the accordion is expanded by default. */
  readonly defaultExpanded?: boolean;
  /** Called when a tool action is clicked. */
  readonly onActionClick?: ((action: unknown) => void) | undefined;
}

/**
 * `SubAgentAccordion` — renders sub-agent execution as expandable accordions.
 * Each sub-agent invocation gets its own accordion with grouped tool actions.
 */
export function SubAgentAccordion({
  blocks,
  defaultExpanded = false,
  onActionClick,
}: SubAgentAccordionProps): ReactNode {
  if (!blocks?.length) return null;

  return (
    <Box sx={{ mt: 1 }}>
      {blocks.map((block, index) => {
        if (block.kind === 'coord') {
          return null; // Coordinator actions rendered inline
        }

        const isExpanded = defaultExpanded || block.pausedForResume;

        return (
          <BasicAccordion
            key={`${block.instanceKey}-${index}`}
            items={[
              {
                title: block.name || 'Sub-agent',
                content: (
                  <Box sx={{ px: 2, pb: 1 }}>
                    {block.actions.map((action, actionIndex) => (
                      <Box
                        key={`${String((action as unknown as Record<string, unknown>).id)}-${actionIndex}`}
                        component="pre"
                        onClick={() => onActionClick?.(action)}
                        sx={{
                          fontFamily: 'monospace',
                          // eslint-disable-next-line elitea/ad-hoc-font-size — inline code size
                          fontSize: '0.8rem',
                          p: 1,
                          mb: 0.5,
                          backgroundColor: 'action.hover',
                          // eslint-disable-next-line elitea/ad-hoc-radius — inline code border radius
                          borderRadius: 0.5,
                          cursor: 'pointer',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        <Typography
                          variant="caption"
                          sx={{
                            display: 'block',
                            color: 'text.secondary',
                            mb: 0.5,
                          }}
                        >
                          {(action.name as string) || action.type || 'Action'}
                        </Typography>
                        {(action.toolOutputs as string) || ''}
                      </Box>
                    ))}
                    {block.pausedForResume && (
                      <Typography
                        variant="caption"
                        sx={{ color: 'warning.dark', fontStyle: 'italic' }}
                      >
                        Paused — awaiting resume
                      </Typography>
                    )}
                  </Box>
                ),
              },
            ]}
            defaultExpanded={isExpanded}
          />
        );
      })}
    </Box>
  );
}
