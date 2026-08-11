/**
 * The links editor behind every `*_links` field of the Configuration page's
 * Resources section — unit A14, issue #200.
 *
 * These rows become anchors on the Help Center, seen by every authenticated user
 * on the platform, which is why the URL field is the one control on this page
 * with a client-side check at all. The check is a COURTESY, not the boundary:
 * the server refuses a non-http(s) scheme with a 400 whatever this component
 * does (`config_values.go`'s `validateLinks`, and journey J34c forges the
 * request). It exists so an operator who pastes a `javascript:` URL learns why
 * at the moment of pasting rather than after a save round-trip.
 *
 * A blank row is normal and is not an error: the reference page filters
 * entirely-empty rows out on save, and this one does too, so "add a row, change
 * your mind" does not become a validation wall.
 */
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';

import { t } from '@/shared/i18n';

export interface ConfigLink {
  readonly title: string;
  readonly url: string;
}

/**
 * The schemes a browser will EXECUTE rather than navigate to, plus the ones that
 * read the local machine. Kept as an allowlist of what is permitted rather than
 * a denylist of what is not: a denylist is one novel scheme away from being
 * wrong, and the server's own check is an allowlist for the same reason.
 */
export function linkUrlError(url: string): string | undefined {
  const trimmed = url.trim();
  if (trimmed === '') return undefined;
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme === undefined) {
    return t(
      'pages.admin.configuration.links.relative',
      'Enter a full URL beginning with http:// or https://',
    );
  }
  if (scheme !== 'http' && scheme !== 'https') {
    return t(
      'pages.admin.configuration.links.scheme',
      'Only http:// and https:// links are accepted; other schemes run in every reader’s browser.',
    );
  }
  return undefined;
}

/** Drops rows the operator left entirely blank, matching the reference's save. */
export function withoutBlankLinks(links: readonly ConfigLink[]): ConfigLink[] {
  return links.filter((link) => link.title.trim() !== '' || link.url.trim() !== '');
}

/** Reads an unknown stored value into rows, tolerating anything the store holds. */
export function toConfigLinks(value: unknown): ConfigLink[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry): ConfigLink => {
    if (typeof entry !== 'object' || entry === null) return { title: '', url: '' };
    const record = entry as Record<string, unknown>;
    return {
      title: typeof record.title === 'string' ? record.title : '',
      url: typeof record.url === 'string' ? record.url : '',
    };
  });
}

export function ConfigurationLinksEditor({
  fieldKey,
  label,
  links,
  onChange,
  disabled,
}: {
  readonly fieldKey: string;
  readonly label: string;
  readonly links: readonly ConfigLink[];
  readonly onChange: (next: ConfigLink[]) => void;
  readonly disabled: boolean;
}) {
  function update(index: number, patch: Partial<ConfigLink>): void {
    onChange(links.map((link, at) => (at === index ? { ...link, ...patch } : link)));
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {links.map((link, index) => {
        const error = linkUrlError(link.url);
        return (
          <Box
            // The index IS the identity here: rows have no id, and a
            // content-derived key would remount the field the operator is typing
            // in the moment they change it.
            key={`${fieldKey}-${String(index)}`}
            sx={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}
          >
            <TextField
              size="small"
              label={t('pages.admin.configuration.links.title', 'Title')}
              value={link.title}
              disabled={disabled}
              onChange={(event) => {
                update(index, { title: event.target.value });
              }}
              sx={{ flex: '1 1 12rem' }}
            />
            <TextField
              size="small"
              label={t('pages.admin.configuration.links.url', 'URL')}
              value={link.url}
              disabled={disabled}
              error={error !== undefined}
              helperText={error}
              onChange={(event) => {
                update(index, { url: event.target.value });
              }}
              sx={{ flex: '2 1 20rem' }}
            />
            <IconButton
              size="small"
              disabled={disabled}
              // Composed OUTSIDE `t` on purpose: a fallback carrying braces
              // renders them literally when the bundle key is missing, and the
              // bundle string wins over the call-site fallback when it is not.
              aria-label={`${t('pages.admin.configuration.links.remove', 'Remove link')} ${String(index + 1)} — ${label}`}
              onClick={() => {
                onChange(links.filter((_, at) => at !== index));
              }}
            >
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Box>
        );
      })}
      <Box>
        <Button
          size="small"
          variant="outlined"
          disabled={disabled}
          onClick={() => {
            onChange([...links, { title: '', url: '' }]);
          }}
          sx={{ textTransform: 'none' }}
        >
          {`${t('pages.admin.configuration.links.add', 'Add link')} — ${label}`}
        </Button>
      </Box>
    </Box>
  );
}
