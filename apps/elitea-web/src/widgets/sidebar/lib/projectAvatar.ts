/**
 * Ported verbatim from `[fsd]/widgets/sidebar-root/lib/{constants/
 * projectAvatar.constants.js, helpers/projectAvatar.helpers.js}`.
 *
 * R-T1 (`elitea/no-raw-color`) is disabled per literal below, deliberately:
 * this is a fixed, decorative, per-initial-letter avatar palette — same
 * class of thing as GitHub/Slack's deterministic avatar colours — not a
 * themed UI surface. It was a hard-coded, non-brand JS constant in the old
 * app too (never read from `lightPalette.js`/`darkPalette.js`), is
 * identical in both colour schemes by design (an avatar's colour must stay
 * recognisable across a scheme toggle), and is NOT part of
 * `shared/brand/tokens/` (out of this unit's ownership fence to add to,
 * and semantically the wrong place for a decorative constant unrelated to
 * white-labeling).
 */
const PROJECT_AVATAR_COLORS: ReadonlyArray<{ letters: string; color: string }> = [
  // oxlint-disable-next-line elitea/no-raw-color -- see file header: fixed decorative avatar palette, not a themed token.
  { letters: 'ABCD', color: '#eb691e' },
  // oxlint-disable-next-line elitea/no-raw-color -- see file header.
  { letters: 'EFGH', color: '#3B7DD8' },
  // oxlint-disable-next-line elitea/no-raw-color -- see file header.
  { letters: 'IJKL', color: '#8E24AA' },
  // oxlint-disable-next-line elitea/no-raw-color -- see file header.
  { letters: 'MNOP', color: '#00897B' },
  // oxlint-disable-next-line elitea/no-raw-color -- see file header.
  { letters: 'QRST', color: '#43A047' },
  // oxlint-disable-next-line elitea/no-raw-color -- see file header.
  { letters: 'UVWXYZ', color: '#C5A62A' },
];

// oxlint-disable-next-line elitea/no-raw-color -- see file header: fixed decorative fallback, not a themed token.
const DEFAULT_COLOR = '#757575';

export function projectAvatarColor(projectName: string | undefined): string {
  const letter = (projectName ?? '')[0]?.toUpperCase();
  if (!letter) return DEFAULT_COLOR;
  const group = PROJECT_AVATAR_COLORS.find((entry) => entry.letters.includes(letter));
  return group?.color ?? DEFAULT_COLOR;
}

export function projectInitial(projectName: string | undefined): string {
  return (projectName ?? '?')[0]?.toUpperCase() ?? '?';
}
