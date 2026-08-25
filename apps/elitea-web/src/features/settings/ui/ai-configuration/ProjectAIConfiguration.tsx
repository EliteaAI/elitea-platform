/**
 * ProjectAIConfiguration — displays server URL, OpenAI BaseURL, Project ID info.
 * Ported from `apps/elitea-ui/src/[fsd]/features/settings/ui/ai-configuration/Configuration/ProjectAIConfiguration.jsx`.
 */
import { memo } from 'react';
import { useTheme, type Theme } from '@mui/material/styles';

import Box from '@mui/material/Box';

import { t } from '@/shared/i18n';
import { toAbsoluteApiUrl, toOpenAiBaseUrl } from '@/shared/lib/api-url';

import FieldWithCopy from './FieldWithCopy';

interface ProjectAIConfigurationProps {
  userApiUrl?: string;
  /**
   * The project the user works in. This is the project that pays for a `/llm`
   * call, and the value a caller sends in `X-Project-Id`.
   */
  projectId?: string;
}

export default memo(function ProjectAIConfiguration({ userApiUrl, projectId }: ProjectAIConfigurationProps) {
  const theme = useTheme();
  const styles = projectAIConfigurationStyles(theme);

  /*
   * ABSOLUTE, NOT RELATIVE. `vite_server_url` ships as the path `/api/v2`
   * whenever one gateway fronts both the SPA and elitea-main. These two
   * fields therefore used to render `/llm/v1` and `/api/v2` beside a copy
   * button. Neither
   * addresses anything once it leaves the page — and leaving the page is the
   * entire purpose of a copy button here. See `shared/lib/api-url.ts`.
   */
  const notConfigured = t('ai-configuration.projectConfig.notConfigured', 'Not configured');
  const baseUrl = userApiUrl ? toOpenAiBaseUrl(userApiUrl) : notConfigured;
  const serverUrl = userApiUrl ? toAbsoluteApiUrl(userApiUrl) : notConfigured;

  return (
    <Box sx={styles.projectConfigSection}>
      {/*
        The second cell of this row held an `OpenAI-Project:` field, filled
        from the project that owns the default model. Two defects, one field:

        1. `OpenAI-Project` is not a billing selector. The `/llm` edge reads
           `X-Project-Id`, then `OpenAI-Organization`, and it discards
           `OpenAI-Project` on purpose (spec-llm-project-scope §6.1). The
           field advertised a header that does nothing.
        2. The value was the project that owns the model — the public project
           for a shared model — and it sat beside `Project ID:`, the project
           that pays, with no text to tell a reader which was which (§9.3).

        §9.3 permits the panel to show the model project or to drop it. This
        drops it: the panel now shows one project id, and it is the one a
        caller sends. To bring the model project back, give it a label that
        names it as the model owner, and add the matching `en.json` entry —
        a bundle value BEATS the call-site fallback, so a new label without
        a new bundle entry silently keeps rendering the old text.
      */}
      <Box sx={styles.fieldsGrid}>
        <FieldWithCopy label={`${t('ai-configuration.projectConfig.openaiBase', 'OpenAI-BaseURL:')} `} value={baseUrl} />
        <Box />
      </Box>
      <Box sx={styles.fieldsGrid}>
        <FieldWithCopy label={`${t('ai-configuration.projectConfig.serverUrl', 'Server URL:')} `} value={serverUrl} />
        <FieldWithCopy label={`${t('ai-configuration.projectConfig.projectId', 'Project ID:')} `} value={projectId || notConfigured} />
      </Box>
    </Box>
  );
});

function projectAIConfigurationStyles(theme: ReturnType<typeof useTheme>) {
  const t = theme as Theme;
  return {
    projectConfigSection: {
      flexShrink: 0,
      padding: '1rem 1.5rem',
      backgroundColor: t.vars.palette.background.eliteaDefault,
      borderBottom: `1px solid ${t.vars.palette.border.lines}`,
      gap: '0.25rem',
      width: '100%',
    },
    fieldsGrid: {
      display: 'grid',
      gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
      gap: '1rem',
    },
  };
}
