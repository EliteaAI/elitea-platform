import type { ReactNode } from 'react';
import { useState } from 'react';

import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { useNavigate } from '@tanstack/react-router';

import {
  exportSkill,
  SkillImportButton,
  SkillsList,
  useSkillMutations,
  useSkills,
  type SkillRecord,
} from '@/features/skills';
import { t } from '@/shared/i18n';
import { BaseBtn } from '@/shared/ui/BaseBtn';
import { DeleteEntityModal } from '@/shared/ui/DeleteEntityModal';
import { SimpleSearchBar } from '@/shared/ui/SimpleSearchBar';

import { useSelectedProjectId } from './lib/useSelectedProjectId';

function downloadMarkdown(content: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function Skills(): ReactNode {
  const navigate = useNavigate();
  const projectId = useSelectedProjectId();
  const [query, setQuery] = useState('');
  const [pendingDelete, setPendingDelete] = useState<SkillRecord>();
  const [actionError, setActionError] = useState<string>();
  const skills = useSkills(projectId, query);
  const mutations = useSkillMutations(projectId);

  const handleExport = async (skill: SkillRecord): Promise<void> => {
    if (!projectId) return;
    setActionError(undefined);
    try {
      downloadMarkdown(await exportSkill(projectId, skill.id), `${skill.name || 'skill'}.md`);
    } catch {
      setActionError(t('skills.page.exportError', 'Failed to export the skill.'));
    }
  };

  return (
    <Box sx={pageSx}>
      <Box sx={headerSx}>
        <Typography variant="headingLarge">{t('skills.page.title', 'Skills')}</Typography>
        <Box sx={actionsSx}>
          <SkillImportButton
            isImporting={mutations.importFile.isPending}
            onImport={async (file) => {
              await mutations.importFile.mutateAsync(file);
            }}
          />
          <BaseBtn
            variant="contained"
            startIcon={<AddOutlinedIcon />}
            onClick={() => void navigate({ to: '/skills/create' })}
          >
            {t('skills.page.create', 'Create skill')}
          </BaseBtn>
        </Box>
      </Box>
      <SimpleSearchBar
        value={query}
        onChange={setQuery}
        placeholder={t('skills.page.search', 'Search skills')}
      />
      {actionError && <Typography role="alert">{actionError}</Typography>}
      <SkillsList
        items={skills.data?.items ?? []}
        isLoading={skills.isFetching && skills.data === undefined}
        isError={skills.isError}
        query={query}
        onSelect={(skillId) => {
          void navigate({
            to: '/skills/$tab/$skillId',
            params: { tab: 'all', skillId },
          });
        }}
        onDelete={setPendingDelete}
        onExport={(skill) => {
          void handleExport(skill);
        }}
      />
      <DeleteEntityModal
        open={pendingDelete !== undefined}
        {...(pendingDelete ? { name: pendingDelete.name } : {})}
        confirming={mutations.remove.isPending}
        onClose={() => setPendingDelete(undefined)}
        onConfirm={() => {
          if (!pendingDelete) return;
          void mutations.remove
            .mutateAsync({ skillId: pendingDelete.id })
            .then(() => setPendingDelete(undefined))
            .catch(() => setActionError(t('skills.page.deleteError', 'Failed to delete the skill.')));
        }}
      />
    </Box>
  );
}

const pageSx: SxProps<Theme> = (theme: Theme) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(2),
  padding: theme.spacing(3),
});
const headerSx: SxProps<Theme> = { display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
const actionsSx: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 1 };
