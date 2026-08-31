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
  SkillEditorToolbar,
  SkillForm,
  SkillPublishControls,
  useBindSkillIconMutation,
  useSkill,
  useSkillMutations,
  type SkillIconControl,
  type SkillIconMeta,
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

export function skillVersionKey(version: SkillVersion): string {
  return String(version.id ?? version.name);
}

/**
 * The icon a skill currently wears, read from the shape the API writes:
 * `version_details.meta.icon_meta`. It is the same path the old app's own
 * optimistic update patches, so a change here and a change there disagree
 * loudly rather than silently.
 */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function toSkillIconMeta(skill: SkillRecord | undefined): SkillIconMeta | null {
  const version = skill?.version_details ?? skill?.versions?.[0];
  const iconMeta = version?.meta?.['icon_meta'] as { name?: unknown; url?: unknown } | undefined;
  const name = nonEmptyString(iconMeta?.name);
  const url = nonEmptyString(iconMeta?.url);
  // A reset writes `{}` (or an empty name/url pair); either way there is no
  // icon, and returning a half-filled meta would draw a broken image.
  return name !== undefined && url !== undefined ? { name, url } : null;
}

/** The version id an icon binds to: the one on screen, else the skill's default. */
export function skillIconVersionId(
  skill: SkillRecord | undefined,
  routeVersion: string | undefined,
): string | undefined {
  if (routeVersion !== undefined && /^[0-9]+$/.test(routeVersion)) return routeVersion;
  const id = skill?.version_details?.id ?? skill?.versions?.[0]?.id;
  return id === undefined ? undefined : String(id);
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
  readonly publishing: ReactNode;
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
        publishing={props.publishing}
      />
    </Box>
  );
}

/**
 * buildSkillIconControl returns the icon binding, or `undefined` when there is
 * nothing to bind to — no project, or a skill whose version id is not known
 * yet. `undefined` is what disables the control and explains why.
 */
function buildSkillIconControl(args: {
  readonly projectId: string | undefined;
  readonly versionId: string | undefined;
  readonly iconMeta: SkillIconMeta | null;
  readonly bind: (versionId: string, iconMeta: SkillIconMeta | null) => void;
}): SkillIconControl | undefined {
  const { projectId, versionId } = args;
  if (!projectId || !versionId) return undefined;
  return {
    projectId,
    versionId,
    iconMeta: args.iconMeta,
    onIconChange: (iconMeta) => { args.bind(versionId, iconMeta); },
  };
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
  const bindIcon = useBindSkillIconMutation(projectId ?? '');

  useEffect(() => setValue(initialValue), [initialValue]);

  // The icon is NOT part of the form's dirty state: it is persisted by its own
  // route the moment it is chosen, exactly as the baseline does. Folding it
  // into `value` would make picking an icon look like an unsaved edit and then
  // save it a second time through a route that does not carry it.
  const iconControl = buildSkillIconControl({
    projectId,
    versionId: skillIconVersionId(detail.data, params.version),
    iconMeta: toSkillIconMeta(detail.data),
    bind: (versionId, iconMeta) => {
      void bindIcon
        .mutateAsync({ versionId, iconMeta })
        .then(() => detail.refetch())
        .catch(() => setError(t('skills.edit.iconError', 'Failed to update the skill icon.')));
    },
  });



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
        publishing={
          <SkillPublishControls
            projectId={projectId}
            skill={detail.data}
            skillId={params.skillId}
            versionId={params.version}
            permissions={permissions}
            onPublished={() => void detail.refetch()}
          />
        }
      />
      {error && <Typography role="alert">{error}</Typography>}
      <Box sx={contentSx}>
        <Box sx={formPaneSx}>
          <SkillForm
            value={value}
            onChange={setValue}
            disabled={mutations.update.isPending}
            showErrors={showErrors}
            icon={iconControl}
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
