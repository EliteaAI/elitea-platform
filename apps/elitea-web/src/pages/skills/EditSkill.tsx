import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';

import AddOutlinedIcon from '@mui/icons-material/AddOutlined';
import Box from '@mui/material/Box';
import MenuItem from '@mui/material/MenuItem';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { useNavigate, useParams } from '@tanstack/react-router';

import {
  exportSkill,
  isSkillValid,
  PublishSkillModal,
  SkillEditorToolbar,
  SkillForm,
  useSkill,
  useSkillMutations,
  useSkillPublishing,
  type SkillPublishingState,
  type SkillPublishTarget,
  type SkillRecord,
  type SkillVersion,
  type SkillWriteInput,
} from '@/features/skills';
import { hasBackendCapability } from '@/shared/config';
import { usePermissionSet } from '@/widgets/sidebar';
import { t } from '@/shared/i18n';
import { BaseBtn } from '@/shared/ui/BaseBtn';
import { BaseModal } from '@/shared/ui/BaseModal';
import { DeleteEntityModal } from '@/shared/ui/DeleteEntityModal';

import { useSelectedProjectId } from './lib/useSelectedProjectId';
import { SkillTestPanel } from './SkillTestPanel';

interface EditSkillParams {
  readonly tab?: string;
  readonly skillId?: string;
  readonly version?: string;
}

export function toSkillForm(skill: SkillRecord | undefined): SkillWriteInput {
  if (!skill) return { name: '', description: '', instructions: '', tags: [] };
  const version = skill.version_details ?? skill.versions?.[0];
  return {
    name: skill.name,
    description: skill.description ?? '',
    instructions: version?.instructions ?? '',
    tags: version?.tags ?? [],
  };
}

/**
 * The status of the version the editor is showing.
 *
 * A skill version carries `status` ('draft' or 'published') since the
 * skill-publishing migration; a record from an older deployment carries none,
 * and that reads as 'draft' — the value the column defaults to — rather than as
 * "unknown", so the Publish control appears instead of silently vanishing.
 */
export function versionStatusOf(
  skill: SkillRecord | undefined,
  versionId: string | undefined,
): string | undefined {
  if (!skill) return undefined;
  const selected =
    versionId === undefined
      ? skill.version_details
      : skill.versions?.find((version) => String(version.id) === versionId);
  const status = (selected as { readonly status?: unknown } | undefined)?.status;
  return typeof status === 'string' && status ? status : 'draft';
}

/**
 * The (skill, version) a publish would act on.
 *
 * `params.version` is what the URL selects; when the route carries none the
 * editor is showing `version_details`, and that is the row the server would
 * publish too. Falling back to the FIRST version instead would publish
 * something other than what is on screen whenever the default version is not
 * first in the list.
 */
export function publishTargetOf(
  skill: SkillRecord | undefined,
  skillId: string | undefined,
  versionId: string | undefined,
): SkillPublishTarget {
  const resolved = Number(versionId ?? skill?.version_details?.id ?? Number.NaN);
  return {
    skillId: skillId === undefined ? undefined : Number(skillId),
    versionId: Number.isNaN(resolved) ? undefined : resolved,
    versionStatus: versionStatusOf(skill, versionId),
    versionNames: (skill?.versions ?? []).map((version) => version.name),
  };
}

export function skillVersionKey(version: SkillVersion): string {
  return String(version.id ?? version.name);
}

function downloadMarkdown(content: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

interface SkillEditorHeaderProps {
  readonly skill: SkillRecord;
  readonly versions: readonly SkillVersion[];
  readonly activeVersion: string | undefined;
  readonly isDirty: boolean;
  readonly isSaving: boolean;
  readonly isSettingDefault: boolean;
  readonly onNavigateVersion: (version: string) => void;
  readonly onNewVersion: () => void;
  readonly onSetDefault: (version: string) => void;
  readonly onSave: () => void;
  readonly onDiscard: () => void;
  readonly onDelete: () => void;
  readonly onExport: () => void;
  readonly publishing: SkillPublishingState;
}

function SkillEditorHeader(props: SkillEditorHeaderProps): ReactNode {
  const selectedVersion =
    props.activeVersion ?? skillVersionKey(props.skill.version_details ?? props.versions[0]!);
  return (
    <Box sx={headerSx}>
      <Box sx={titleSx}>
        <Typography variant="headingSmall">{props.skill.name}</Typography>
        {props.versions.length > 0 && (
          <Select
            size="small"
            value={selectedVersion}
            onChange={(event) => props.onNavigateVersion(event.target.value)}
          >
            {props.versions.map((version) => (
              <MenuItem
                key={skillVersionKey(version)}
                value={skillVersionKey(version)}
              >
                {version.name}
              </MenuItem>
            ))}
          </Select>
        )}
        <BaseBtn
          variant="secondary"
          startIcon={<AddOutlinedIcon />}
          onClick={props.onNewVersion}
        >
          {t('skills.edit.newVersion', 'New version')}
        </BaseBtn>
        {props.activeVersion && (
          <BaseBtn
            variant="secondary"
            disabled={props.isSettingDefault}
            onClick={() => props.onSetDefault(props.activeVersion ?? '')}
          >
            {t('skills.edit.setDefault', 'Set default')}
          </BaseBtn>
        )}
      </Box>
      <SkillEditorToolbar
        isDirty={props.isDirty}
        isSaving={props.isSaving}
        canDelete
        onSave={props.onSave}
        onDiscard={props.onDiscard}
        onDelete={props.onDelete}
        onExport={props.onExport}
        canShowPublish={props.publishing.canShowPublish}
        canPublish={props.publishing.canPublish}
        canUnpublish={props.publishing.canUnpublish}
        isUnpublishing={props.publishing.isUnpublishing}
        onPublish={props.publishing.open}
        onUnpublish={() => void props.publishing.unpublish()}
      />
    </Box>
  );
}

export function EditSkill(): ReactNode {
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as EditSkillParams;
  const projectId = useSelectedProjectId();
  const detail = useSkill(projectId, params.skillId, params.version);
  const mutations = useSkillMutations(projectId);
  const initialValue = useMemo(() => toSkillForm(detail.data), [detail.data]);
  const [value, setValue] = useState<SkillWriteInput>(initialValue);
  const [showErrors, setShowErrors] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [versionOpen, setVersionOpen] = useState(false);
  const [versionName, setVersionName] = useState('');
  const [error, setError] = useState<string>();
  const permissions = usePermissionSet(projectId);

  useEffect(() => setValue(initialValue), [initialValue]);

  const publishing = useSkillPublishing(
    projectId,
    publishTargetOf(detail.data, params.skillId, params.version),
    permissions,
    () => void detail.refetch(),
  );

  // The test run POSTs `predict_llm`, which no router mounts, so the pane
  // stays hidden — see `shared/config/backendCapabilities`.
  const canTestSkill = hasBackendCapability('aiGeneration');

  const isDirty = JSON.stringify(value) !== JSON.stringify(initialValue);
  const versions = detail.data?.versions ?? [];

  const save = (): void => {
    setShowErrors(true);
    if (!isSkillValid(value) || !params.skillId) return;
    void mutations.update
      .mutateAsync({
        skillId: params.skillId,
        input: value,
        ...(params.version ? { versionId: params.version } : {}),
      })
      .catch(() => setError(t('skills.edit.saveError', 'Failed to save the skill.')));
  };

  const doExport = async (): Promise<void> => {
    if (!projectId || !params.skillId) return;
    try {
      const content = await exportSkill(projectId, params.skillId, params.version);
      downloadMarkdown(content, `${detail.data?.name || 'skill'}.md`);
    } catch {
      setError(t('skills.edit.exportError', 'Failed to export the skill.'));
    }
  };

  if (detail.isFetching && detail.data === undefined) {
    return <Typography>{t('skills.edit.loading', 'Loading skill…')}</Typography>;
  }
  if (detail.isError || !detail.data) {
    return <Typography role="alert">{t('skills.edit.loadError', 'Failed to load this skill.')}</Typography>;
  }

  return (
    <Box sx={pageSx}>
      <SkillEditorHeader
        skill={detail.data}
        versions={versions}
        activeVersion={params.version}
        isDirty={isDirty}
        isSaving={mutations.update.isPending}
        isSettingDefault={mutations.setDefault.isPending}
        onNavigateVersion={(version) => {
          void navigate({
            to: '/skills/$tab/$skillId/$version',
            params: { tab: params.tab ?? 'all', skillId: params.skillId ?? '', version },
          });
        }}
        onNewVersion={() => setVersionOpen(true)}
        onSetDefault={(version) => {
          if (params.skillId) {
            void mutations.setDefault.mutateAsync({ skillId: params.skillId, versionId: version });
          }
        }}
        onSave={save}
        onDiscard={() => setValue(initialValue)}
        onDelete={() => setDeleteOpen(true)}
        onExport={() => void doExport()}
        publishing={publishing}
      />
      {error && <Typography role="alert">{error}</Typography>}
      <Box sx={contentSx}>
        <Box sx={formPaneSx}>
          <SkillForm
            value={value}
            onChange={setValue}
            disabled={mutations.update.isPending}
            showErrors={showErrors}
          />
        </Box>
        {projectId && canTestSkill && (
          <Box sx={testPaneSx}>
            <SkillTestPanel
              projectId={projectId}
              instructions={value.instructions}
              skillName={value.name}
            />
          </Box>
        )}
      </Box>
      <PublishSkillModal state={publishing} />
      <DeleteEntityModal
        open={deleteOpen}
        name={detail.data.name}
        confirming={mutations.remove.isPending}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => {
          if (!params.skillId) return;
          void mutations.remove.mutateAsync({ skillId: params.skillId }).then(() =>
            navigate({ to: '/skills/$tab', params: { tab: params.tab ?? 'all' }, replace: true }),
          );
        }}
      />
      <BaseModal
        open={versionOpen}
        title={t('skills.edit.newVersionTitle', 'Create skill version')}
        onClose={() => setVersionOpen(false)}
        onConfirm={() => {
          if (!params.skillId || !versionName.trim()) return;
          void mutations.createVersion
            .mutateAsync({
              skillId: params.skillId,
              input: { name: versionName.trim(), instructions: value.instructions, tags: value.tags },
            })
            .then(() => {
              setVersionName('');
              setVersionOpen(false);
            });
        }}
        actions={{ confirming: mutations.createVersion.isPending }}
        content={
          <TextField
            fullWidth
            label={t('skills.edit.versionName', 'Version name')}
            value={versionName}
            onChange={(event) => setVersionName(event.target.value)}
          />
        }
      />
    </Box>
  );
}

const pageSx: SxProps<Theme> = { height: '100%', display: 'flex', flexDirection: 'column' };
const headerSx: SxProps<Theme> = (theme: Theme) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: theme.spacing(1),
  padding: theme.spacing(1, 3),
  borderBottom: `0.0625rem solid ${theme.vars.palette.border.lines}`,
});
const titleSx: SxProps<Theme> = { display: 'flex', alignItems: 'center', gap: 1 };
const contentSx: SxProps<Theme> = { flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: '1fr 1fr' };
const formPaneSx: SxProps<Theme> = (theme: Theme) => ({ overflowY: 'auto', padding: theme.spacing(3) });
const testPaneSx: SxProps<Theme> = (theme: Theme) => ({
  minWidth: 0,
  padding: theme.spacing(3),
  borderLeft: `0.0625rem solid ${theme.vars.palette.border.lines}`,
});
