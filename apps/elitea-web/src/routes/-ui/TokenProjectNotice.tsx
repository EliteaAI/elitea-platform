/**
 * What the create-personal-token page SAYS about the project binding, plus
 * the copy for the two failures that binding can cause
 * (`spec-llm-project-scope` §4, ADR-0018).
 *
 * This file holds no control. The product decision is that a new token binds
 * to the project the sidebar selects, so the page offers no second choice.
 * The page must still disclose the binding, because the user cannot get these
 * two facts back afterwards: the bound project pays for the calls of the
 * token, and no API changes the binding later.
 *
 * Lives in `routes/-ui/` — the `-`-prefixed helper convention TanStack's
 * generator ignores when it builds the route tree — because it is used by
 * exactly one route and pulling it out is what keeps that route inside the
 * §3.5 file-length and complexity budgets.
 */
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
 *
 * Both project messages send the user to the SIDEBAR project selector. That
 * selector is the only project control the flow has.
 */
export function createTokenFailureMessage(error: unknown): string {
  const code = tokenProjectErrorCode(error);
  if (code === 'project_forbidden') {
    return t(
      'entities.token.form.projectForbidden',
      'You are not a member of this project. Select a different project in the sidebar, then create the token again.',
    );
  }
  if (code === 'invalid_project_id') {
    return t(
      'entities.token.form.invalidProjectId',
      'This project is not a valid choice. Select a different project in the sidebar, then create the token again.',
    );
  }
  return t('entities.token.form.createFailed', 'The system did not create the token. Try again.');
}

/* ── the binding disclosure ────────────────────────────────────────────── */

/** The form's own field width, matching the name and expiration rows. */
const FIELD_SX: SxProps<Theme> = { width: '17.875rem' };
const HELPER_SX: SxProps<Theme> = {
  marginTop: '0.25rem',
  fontSize: ({ typography }) => typography.bodySmall.fontSize,
};

export interface TokenProjectNoticeProps {
  /**
   * The name of the project the token binds to, or `null` for an unbound
   * token. The caller derives this from the id it actually sends, never from
   * the store alone: a store value the request drops must not read here as a
   * binding.
   */
  readonly projectName: string | null;
}

export function TokenProjectNotice({ projectName }: TokenProjectNoticeProps) {
  return (
    <Box sx={FIELD_SX}>
      <Typography
        variant="bodySmall"
        color="text.secondary"
        sx={HELPER_SX}
      >
        {projectName === null
          ? t('entities.token.form.projectNoneNote', 'This token gets no project, and you cannot change this later.')
          : t(
              'entities.token.form.projectNote',
              'The project {{project}} pays for this token, and you cannot change this later.',
              { project: projectName },
            )}
      </Typography>
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
