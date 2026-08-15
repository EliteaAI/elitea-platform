/**
 * The optional project binding on the create-personal-token form, plus the
 * copy for the two failures it can provoke (`spec-llm-project-scope` §4,
 * ADR-0018).
 *
 * Lives in `routes/-ui/` — the `-`-prefixed helper convention TanStack's
 * generator ignores when it builds the route tree — because it is used by
 * exactly one route and pulling it out is what keeps that route inside the
 * §3.5 file-length and complexity budgets.
 *
 * The three facts the copy must carry, because none of them is recoverable
 * from the UI afterwards: the bound project pays, the binding cannot be
 * changed, and it dies with the user's membership of that project.
 */
import type { CSSProperties } from 'react';

import type { UseFormRegisterReturn } from 'react-hook-form';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import { tokenProjectErrorCode } from '@/entities/token/model/selectors';
import { t } from '@/shared/i18n';

/* ── create-failure copy (§4 error contract) ──────────────────────────── */

/**
 * `POST /auth/token/` answers the two project failures with the NESTED
 * envelope `{"error":{message,type,code}}`, and every other failure with the
 * FLAT `{"error":"…"}`. `tokenProjectErrorCode` reads the nested shape and
 * returns `null` for the flat one, so both stay usable: a project failure
 * names the project problem, anything else falls back to the generic line.
 */
export function createTokenFailureMessage(error: unknown): string {
  const code = tokenProjectErrorCode(error);
  if (code === 'project_forbidden') {
    return t(
      'entities.token.form.projectForbidden',
      'You are not a member of this project. Select a different project, or create the token with no project.',
    );
  }
  if (code === 'invalid_project_id') {
    return t(
      'entities.token.form.invalidProjectId',
      'This project is not a valid choice. Select a project from the list again.',
    );
  }
  return t('entities.token.form.createFailed', 'The system did not create the token. Try again.');
}

/* ── the field ─────────────────────────────────────────────────────────── */

/** Deliberately not exported — the knip gate counts an unused export as dead code. */
interface TokenProjectOption {
  readonly id: string;
  readonly name: string;
}

export interface TokenProjectFieldProps {
  /** The projects the caller may bind to — the app's existing projects query. */
  readonly projects: readonly TokenProjectOption[];
  /** `register('projectId')` from the page's react-hook-form instance. */
  readonly registration: UseFormRegisterReturn;
  /** Whether a project is currently selected. */
  readonly bound: boolean;
  /** The page's shared native-`<select>` look, so this control matches its siblings. */
  readonly selectStyle?: CSSProperties;
}

/** The form's own field width, matching the name and expiration rows. */
const FIELD_SX: SxProps<Theme> = { width: '17.875rem' };
const HELPER_SX: SxProps<Theme> = {
  marginTop: '0.25rem',
  fontSize: ({ typography }) => typography.bodySmall.fontSize,
};

export function TokenProjectField({
  projects,
  registration,
  bound,
  selectStyle,
}: TokenProjectFieldProps) {
  return (
    <Box sx={FIELD_SX}>
      <select
        id="projectId"
        {...registration}
        style={selectStyle}
        aria-label={t('entities.token.form.project', 'Project')}
      >
        {/* The empty value IS the unbound default — §4 makes it mandatory. */}
        <option value="">{t('entities.token.form.projectNone', 'No project (default)')}</option>
        {projects.map((project) => (
          <option
            key={project.id}
            value={project.id}
          >
            {project.name}
          </option>
        ))}
      </select>
      <Typography
        variant="bodySmall"
        color="text.secondary"
        sx={HELPER_SX}
      >
        {t(
          'entities.token.form.projectHelp',
          'The project you select pays for the calls of this token. You cannot change the project after you create the token. If you leave the project, the token does not work for that project.',
        )}
      </Typography>
      {bound && (
        <Typography
          variant="bodySmall"
          color="text.secondary"
          sx={HELPER_SX}
        >
          {/* §9.4: a key that already carries its project needs no header. */}
          {t(
            'entities.token.form.projectHeaderNote',
            'A token with a project does not need the X-Project-Id header in a request.',
          )}
        </Typography>
      )}
    </Box>
  );
}

/* ── the failure line ──────────────────────────────────────────────────── */

export interface TokenCreateErrorProps {
  readonly message: string | null;
}

export function TokenCreateError({ message }: TokenCreateErrorProps) {
  if (message === null) return null;
  return (
    <Box
      role="alert"
      sx={FIELD_SX}
    >
      <Typography
        variant="bodySmall"
        color="error"
      >
        {message}
      </Typography>
    </Box>
  );
}
