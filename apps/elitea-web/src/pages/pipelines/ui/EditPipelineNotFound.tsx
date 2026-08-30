import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

import { t } from '@/shared/i18n';
import { NoResultsMessage } from '@/shared/ui/NoResultsMessage';

const pageSx: SxProps<Theme> = { height: '100%', display: 'flex', flexDirection: 'column' };

export interface EditPipelineNotFoundProps {
  /** `'pipeline'` — the detail fetch 404/400'd; `'version'` — the URL names a version this pipeline does not have. */
  readonly kind: 'pipeline' | 'version';
}

/**
 * The pipeline editor's two dead ends, lifted verbatim out of
 * `EditPipeline.tsx`'s early returns. Behaviour and copy are unchanged — the
 * same two `NoResultsMessage` blocks with the same four i18n keys — it is
 * only their twenty-odd lines that moved, to keep that page inside the §3.5
 * 400-line budget while the version bar was mounted into its tab bar.
 */
export function EditPipelineNotFound({ kind }: EditPipelineNotFoundProps): ReactNode {
  return (
    <Box sx={pageSx}>
      {kind === 'pipeline' ? (
        <NoResultsMessage
          title={t('pages.pipelines.editPipeline.pipelineNotFound.title', 'Pipeline not found')}
          description={t('pages.pipelines.editPipeline.pipelineNotFound.description', 'This pipeline no longer exists.')}
        />
      ) : (
        <NoResultsMessage
          title={t('pages.pipelines.editPipeline.notFound.title', 'Version not found')}
          description={t('pages.pipelines.editPipeline.notFound.description', 'This version no longer exists.')}
        />
      )}
    </Box>
  );
}
