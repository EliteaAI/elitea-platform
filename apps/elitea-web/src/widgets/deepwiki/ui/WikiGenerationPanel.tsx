/**
 * Start, watch and stop a wiki generation (DWIKI-005), and pick it back up
 * after a reload (DWIKI-006).
 *
 * THE REDUCER IS `features/wiki-generation`; this panel owns only the edges:
 * the slots check before starting, the request that starts a run, the DELETE
 * that stops one, and the storage that remembers a running invocation so a
 * reload polls it again rather than showing an idle screen over a run that is
 * still going.
 *
 * `code_toolkit` IS REQUIRED BY THE FACADE (`configuration.parameters.
 * code_toolkit`, an integer naming a configuration). A toolkit without one is
 * refused HERE, naming the setting, rather than sent — the facade's 400 would
 * arrive as "the generation failed" with no field to fix.
 */
import { useCallback, useMemo, useState } from 'react';

import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useQueryClient } from '@tanstack/react-query';

import type { ToolkitSettings } from '@/entities/wiki';
import { useWikiGeneration, type GenerationState } from '@/features/wiki-generation';
import {
  cancelDeepWikiInvocation,
  getDeepWikiInvocation,
  invokeDeepWikiTool,
  useGetDeepWikiSlots,
} from '@/shared/api/generated/deepwiki/deepwiki';
import { unwrapBody } from '@/shared/api/unwrap';
import { t } from '@/shared/i18n';

import { createGenerationStorage } from '../lib/generationStorage';

/** The provider's own toolkit name, which the SPI path carries. */
const WIKI_TOOLKIT_NAME = 'wikis';
const TOOL = 'generate_wiki';
/** The legacy cadence for the slots poll. */
const SLOTS_REFETCH_MS = 5000;

type PlannerMode = 'deepagents' | 'cluster';

interface WikiGenerationPanelProps {
  readonly projectId: string | number;
  readonly toolkitId: string | number;
  readonly settings: ToolkitSettings;
  /** Whether a wiki already exists, which turns Generate into a confirmed regenerate. */
  readonly hasWiki: boolean;
}

interface SlotsBody {
  readonly can_start?: boolean;
  readonly total?: number;
  readonly active?: number;
}

function slotsLabel(slots: SlotsBody | undefined): string {
  if (slots === undefined) return t('deepwiki.slots.checking', 'Checking slots…');
  return t('deepwiki.slots.status', '{{active}} of {{total}} slots in use', {
    active: String(slots.active ?? 0),
    total: String(slots.total ?? 0),
  });
}

function generateLabel(running: boolean, canStart: boolean): string {
  if (running) return t('deepwiki.generate.running', 'Generating…');
  if (!canStart) return t('deepwiki.generate.slotsBusy', 'All slots busy');
  return t('deepwiki.generate.start', 'Generate wiki');
}

function codeToolkitOf(settings: ToolkitSettings): number | null {
  const raw = settings['code_toolkit'] ?? settings['toolkit_configuration_code_toolkit'];
  const id = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function WikiGenerationPanel({ projectId, toolkitId, settings, hasWiki }: WikiGenerationPanelProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const storage = useMemo(() => createGenerationStorage(projectId, toolkitId), [projectId, toolkitId]);
  // A reload RESUMES: the stored invocation is polled again from the first
  // render rather than the screen showing idle over a run still going.
  const [invocationId, setInvocationId] = useState<string | null>(() => storage.load()?.invocationId ?? null);
  const [planner, setPlanner] = useState<PlannerMode>('cluster');
  const [excludeTests, setExcludeTests] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);

  const slots = useGetDeepWikiSlots(Number(projectId), { query: { refetchInterval: SLOTS_REFETCH_MS, retry: false } });
  const slotsBody = slots.data === undefined ? undefined : (unwrapBody(slots.data) as SlotsBody | undefined);
  const canStart = slotsBody?.can_start !== false;

  const onSettled = useCallback(
    (state: GenerationState) => {
      // Forget the run: a reload after this must not poll a finished
      // invocation and show it as running (DWIKI-006's second clause).
      storage.clear();
      if (state.status.status === 'completed') {
        void queryClient.invalidateQueries({ queryKey: ['deepwiki'] });
      }
    },
    [queryClient, storage],
  );

  const generation = useWikiGeneration(invocationId, {
    poll: async (id) => {
      const body = unwrapBody(await getDeepWikiInvocation(Number(projectId), WIKI_TOOLKIT_NAME, TOOL, id));
      return body as never;
    },
    onSettled,
  });
  const running = invocationId !== null && generation.status.status === 'running';

  // Stopping is a DELETE on the invocation — the facade's cancel, not a task
  // API; the poll that follows reports Stopped, which the reducer reads as an
  // error status with the provider's own message.
  const stop = useCallback(async () => {
    if (invocationId === null) return;
    setStopping(true);
    try {
      await cancelDeepWikiInvocation(Number(projectId), WIKI_TOOLKIT_NAME, TOOL, invocationId);
    } catch (cause) {
      setStartError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStopping(false);
    }
  }, [invocationId, projectId]);

  const start = useCallback(async () => {
    setConfirmOpen(false);
    setStartError(null);
    const codeToolkit = codeToolkitOf(settings);
    if (codeToolkit === null) {
      setStartError(t('deepwiki.generate.noCodeToolkit', 'Set code_toolkit in the toolkit settings first: the provider needs a repository toolkit to clone from.'));
      return;
    }
    try {
      const response = await invokeDeepWikiTool(Number(projectId), WIKI_TOOLKIT_NAME, TOOL, {
        configuration: { parameters: { ...settings, code_toolkit: codeToolkit } },
        parameters: {
          query: 'GO',
          planner_type: planner,
          exclude_tests: planner === 'cluster' ? excludeTests : null,
        },
      });
      const body = unwrapBody(response) as { invocation_id?: unknown } | undefined;
      const id = body?.invocation_id;
      if (typeof id !== 'string' || id === '') {
        throw new Error(t('deepwiki.generate.noInvocation', 'The provider accepted the request but returned no invocation to follow.'));
      }
      storage.save({ invocationId: id, startedAt: Date.now() });
      setInvocationId(id);
    } catch (cause) {
      setStartError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [excludeTests, planner, projectId, settings, storage]);

  return (
    <Stack sx={{ gap: 1 }} data-testid="wiki-generation-panel">
      <Stack sx={{ flexDirection: 'row', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Chip
          size="small"
          variant="outlined"
          data-testid="wiki-slots"
          label={slotsLabel(slotsBody)}
        />
        <ToggleButtonGroup exclusive size="small" value={planner} onChange={(_e, v: PlannerMode | null) => { if (v) setPlanner(v); }} aria-label={t('deepwiki.generate.planner', 'Planner')}>
          <ToggleButton value="deepagents">{t('deepwiki.generate.plannerAgentic', 'Agentic')}</ToggleButton>
          <ToggleButton value="cluster">{t('deepwiki.generate.plannerCluster', 'Clustering')}</ToggleButton>
        </ToggleButtonGroup>
        {planner === 'cluster' ? (
          <FormControlLabel
            control={<Switch size="small" checked={excludeTests} onChange={(_e, v) => { setExcludeTests(v); }} />}
            label={t('deepwiki.generate.excludeTests', 'Skip tests')}
          />
        ) : null}
        <Button
          variant="contained"
          size="small"
          disabled={running || !canStart}
          data-testid="wiki-generate"
          onClick={() => { if (hasWiki) setConfirmOpen(true); else void start(); }}
        >
          {generateLabel(running, canStart)}
        </Button>
        {running ? (
          <Button color="error" size="small" onClick={() => void stop()} disabled={stopping} data-testid="wiki-generate-stop">
            {stopping ? t('deepwiki.generate.stopping', 'Stopping…') : t('deepwiki.generate.stop', 'Stop generation')}
          </Button>
        ) : null}
      </Stack>

      {startError === null ? null : (
        <Alert severity="error" data-testid="wiki-generate-error">{startError}</Alert>
      )}

      {invocationId === null ? null : (
        <Stack sx={{ gap: 0.5 }} data-testid="wiki-generation-log">
          <Typography variant="bodySmall" data-testid="wiki-generation-status" data-status={generation.status.status}>
            {generation.status.message}
          </Typography>
          {generation.thinkingSteps.map((step) => (
            <Typography key={step.id} variant="bodySmall" color="text.secondary">
              {step.message}
            </Typography>
          ))}
        </Stack>
      )}

      <Dialog open={confirmOpen} onClose={() => { setConfirmOpen(false); }}>
        <DialogTitle>{t('deepwiki.generate.confirmTitle', 'Generate wiki documentation?')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('deepwiki.generate.confirmBody', 'This regenerates all wiki documentation from the repository. It may take several minutes.')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setConfirmOpen(false); }}>{t('deepwiki.generate.confirmCancel', 'Cancel')}</Button>
          <Button variant="contained" onClick={() => void start()} data-testid="wiki-generate-confirm">
            {t('deepwiki.generate.confirmStart', 'Generate')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
