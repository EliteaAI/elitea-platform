/**
 * The save gate: while the live graph is one the native pipeline runtime
 * would refuse, the editor's Save button is disabled and the PUT is never
 * issued.
 *
 * ## Why the veto is expressed as a form error
 *
 * The pipeline editor's Save button is `entities/application-form`'s
 * `CreateApplicationTabBar`, and the page computes `canSave={
 * form.formState.isValid && !isSaving}` from the react-hook-form instance it
 * owns. RHF's own mechanism for "something outside the resolver says this
 * form may not be submitted" is a `root.*` error: `setError` publishes
 * `isValid: false` to every subscriber (react-hook-form 7.83,
 * `dist/index.esm.mjs:2751-2755`), which is exactly the flag the Save button
 * is already wired to. Nothing is monkey-patched and no new prop has to be
 * threaded through a page this unit does not own.
 *
 * Two consequences the implementation below has to handle, both measured
 * against the pinned RHF build rather than assumed:
 *
 *  1. A later resolver pass REPLACES `_formState.errors` wholesale, dropping
 *     the root error and flipping `isValid` back to `true` — so the veto has
 *     to be re-asserted whenever `isValid` goes true while the graph is
 *     still inadmissible. It converges: the re-assert publishes `false`, and
 *     `isValid` then stops changing.
 *  2. `clearErrors` does NOT recompute `isValid` (`dist/index.esm.mjs:
 *     2724-2741` never calls `_setValid`). Lifting the veto therefore has to
 *     run `trigger()`, or a fixed graph would leave Save disabled forever.
 *
 * `useLayoutEffect`, not `useEffect`: the re-assert must land before paint,
 * or the button is briefly enabled in a frame an automated click could hit.
 *
 * ## What it deliberately does NOT gate on
 *
 * An editor holding no graph at all (not yet seeded, or a screen with no
 * canvas). See `./useGraphAdmission.ts` — blocking Save there would break
 * saves that have nothing to do with the graph.
 */
import type { ReactNode } from 'react';
import { useLayoutEffect, useRef } from 'react';
import type { FieldValues, UseFormReturn } from 'react-hook-form';
import { useFormContext } from 'react-hook-form';

import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';

import { documentLevelIssues } from '../../lib/graphAdmission.helpers';
import type { GraphAdmissionIssue } from '../../lib/graphAdmission.types';
import { useGraphAdmission } from './useGraphAdmission';

/** The RHF error path the veto occupies. `root.*` errors are RHF's own channel for non-field, externally-sourced refusals. */
const GRAPH_ADMISSION_FIELD = 'root.pipelineGraphAdmission';

const alertSx: SxProps<Theme> = { width: '100%', boxSizing: 'border-box' };
const listSx: SxProps<Theme> = { margin: '0.25rem 0 0', paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' };

export interface GraphAdmissionGateProps {
  /** The configuration panel collapses to a 1.75rem rail; the summary is withheld there, but the veto still runs. */
  readonly summaryHidden?: boolean;
}

/**
 * Holds the form's `isValid` at `false` for as long as the graph is
 * inadmissible. Renders nothing.
 */
function useGraphAdmissionSaveVeto(blocked: boolean): void {
  /*
   * RHF types `useFormContext()` as non-nullable, but it is a bare
   * `useContext` whose default is `null` — and this panel really does render
   * with no `<FormProvider>` above it (the chat-side editor, and this
   * slice's own component tests). A cast plus a guard is the honest reading;
   * the alternative is a crash on every such mount.
   */
  const form = useFormContext() as UseFormReturn<FieldValues> | null;
  const isValid = form?.formState.isValid;
  const setError = form?.setError;
  const clearErrors = form?.clearErrors;
  const trigger = form?.trigger;
  const isVetoing = useRef(false);

  useLayoutEffect(() => {
    if (setError === undefined || clearErrors === undefined || trigger === undefined) return;
    if (blocked) {
      isVetoing.current = true;
      setError(GRAPH_ADMISSION_FIELD, { type: 'graph-admission', message: 'the pipeline graph is not admissible' });
      return;
    }
    if (!isVetoing.current) return;
    isVetoing.current = false;
    clearErrors(GRAPH_ADMISSION_FIELD);
    // `clearErrors` leaves `isValid` where the veto put it; only a real
    // validation pass lifts it. See this module's doc comment, point 2.
    void trigger();
  }, [blocked, isValid, setError, clearErrors, trigger]);
}

/** Stable key for one issue — see `NodeAdmissionIssues.tsx`. */
function issueKey(issue: GraphAdmissionIssue): string {
  return `${issue.rule}|${issue.field}|${issue.subject}`;
}

/** The node ids carrying at least one issue, in canvas order, de-duplicated. */
function offendingNodeIds(issues: readonly GraphAdmissionIssue[]): readonly string[] {
  return [...new Set(issues.flatMap((issue) => (issue.nodeId === undefined ? [] : [issue.nodeId])))];
}

export function GraphAdmissionGate({ summaryHidden = false }: GraphAdmissionGateProps): ReactNode {
  const { issues, hasGraph } = useGraphAdmission();
  useGraphAdmissionSaveVeto(hasGraph && issues.length > 0);

  if (summaryHidden || issues.length === 0) return null;

  const documentIssues = documentLevelIssues(issues);
  const nodeIds = offendingNodeIds(issues);

  return (
    <Alert
      severity="error"
      variant="outlined"
      sx={alertSx}
      data-testid="graph-admission-gate"
    >
      <AlertTitle>{t('features.pipelines.graphAdmissionGate.title', 'This pipeline cannot be saved')}</AlertTitle>
      <Typography variant="bodySmall">
        {t('features.pipelines.graphAdmissionGate.body', 'The runtime would refuse this graph, so saving is blocked until it is fixed.')}
      </Typography>
      <Box
        component="ul"
        sx={listSx}
      >
        {documentIssues.map((issue) => (
          <Typography
            key={issueKey(issue)}
            component="li"
            variant="bodySmall"
            title={issue.citation}
          >
            {issue.message}
          </Typography>
        ))}
        {nodeIds.map((nodeId) => (
          <Typography
            key={nodeId}
            component="li"
            variant="bodySmall"
          >
            {t('features.pipelines.graphAdmissionGate.nodeHint', 'See the errors on node')} {nodeId}
          </Typography>
        ))}
      </Box>
    </Alert>
  );
}
