/**
 * The list editor behind the Features page's two array fields — unit A14,
 * issue #200: `agent_categories` (strings) and `publish_whitelist_project_ids`
 * (integers).
 *
 * A row per entry rather than one comma-separated box. A category may legitimately
 * contain a comma ("Knowledge, Docs & Research" is the shape of the built-in
 * names), so a split on `,` would silently cut one category into two — and the
 * operator would see the result only after a save, in a filter bar, as two
 * categories they did not create.
 *
 * ## Why the element type is enforced HERE as well as on the server
 *
 * The server refuses a wrongly-typed element with a 400 that names the field
 * (`validateArrayItems`), and that is the boundary. This is the courtesy: both
 * consumers of these arrays type-assert their elements and SKIP what does not
 * match, so an entry of the wrong type would have been stored, echoed back and
 * rendered while doing nothing. Catching "12a" as a project id at the moment of
 * typing is much cheaper than catching it as a whitelist that mysteriously omits
 * one project.
 *
 * The integer editor keeps the operator's RAW TEXT while it is invalid rather
 * than coercing it. Coercing "12a" to 12 would let the field silently disagree
 * with what is on screen — the same class of lie as a control that saves into a
 * void, in miniature.
 */
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlineOutlined';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';

import { t } from '@/shared/i18n';

/** The element type a field declares, as far as this editor distinguishes them. */
export type ConfigListItemType = 'string' | 'integer';

/**
 * Reads a stored value into editable rows.
 *
 * Everything is held as TEXT while editing, whatever the declared type: a
 * half-typed number is not a number, and a control that refuses to display what
 * was typed is a control that fights the operator.
 */
export function toConfigListRows(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === 'string') return entry;
    if (typeof entry === 'number') return String(entry);
    // Anything else is a row the store should never have held (the server
    // refuses those). Rendering it blank rather than `[object Object]` lets the
    // operator delete it, which is the only useful thing they can do with it.
    return '';
  });
}

/** The error for one row, or undefined. Blank rows are dropped on save, not flagged. */
export function listRowError(row: string, itemType: ConfigListItemType): string | undefined {
  const trimmed = row.trim();
  if (trimmed === '') return undefined;
  if (itemType === 'integer' && !/^-?\d+$/.test(trimmed)) {
    return t(
      'pages.admin.features.list.integer',
      'Enter a whole number — this is a project id, and a value that is not one is ignored by the guardrail.',
    );
  }
  return undefined;
}

/**
 * Turns rows back into the value the field holds.
 *
 * Called on every keystroke, because the field's value IS the editor's state —
 * there is no second copy of the text, so a discard restores the whole field
 * rather than half of it.
 *
 * That is why an invalid integer row is kept AS ITS RAW TEXT rather than
 * dropped or coerced. Dropping it would delete the character the operator just
 * typed, on the keystroke that made the row invalid — a control that fights back.
 * Coercing "12a" to 12 would make the field disagree with what is on screen,
 * which is the same lie as a control that saves into a void, in miniature. Kept
 * as text, the row shows its error inline, and the save is refused by the server
 * with a 400 that names the field (`validateArrayItems`).
 *
 * A BLANK row is kept too, for the same reason the links editor keeps one:
 * "Add entry" would otherwise create a row that vanished on the same render,
 * because the empty string it starts as would have been filtered out before it
 * reached the value the editor reads back. Blanks are dropped at SAVE time
 * instead (`withoutBlankListEntries`), so "add a row, change your mind" never
 * becomes a validation wall.
 */
export function fromConfigListRows(
  rows: readonly string[],
  itemType: ConfigListItemType,
): Array<string | number> {
  return rows.map((row) => {
    const trimmed = row.trim();
    if (itemType === 'integer' && /^-?\d+$/.test(trimmed)) return Number(trimmed);
    return row;
  });
}

/** Drops rows the operator left blank, matching `withoutBlankLinks`. */
export function withoutBlankListEntries(value: unknown): Array<string | number> {
  if (!Array.isArray(value)) return [];
  return (value as unknown[]).filter((entry): entry is string | number => {
    if (typeof entry === 'number') return true;
    return typeof entry === 'string' && entry.trim() !== '';
  });
}

export function ConfigurationListEditor({
  fieldKey,
  label,
  itemType,
  rows,
  onChange,
  disabled,
}: {
  readonly fieldKey: string;
  readonly label: string;
  readonly itemType: ConfigListItemType;
  readonly rows: readonly string[];
  readonly onChange: (next: string[]) => void;
  readonly disabled: boolean;
}) {
  return (
    <Box
      data-testid={`admin-config-list-${fieldKey}`}
      sx={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}
    >
      {rows.map((row, index) => {
        const error = listRowError(row, itemType);
        return (
          <Box
            // The index is the identity: rows have no id, and a content-derived
            // key would remount the field being typed in on every keystroke.
            key={`${fieldKey}-${String(index)}`}
            sx={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}
          >
            <TextField
              size="small"
              label={`${label} ${String(index + 1)}`}
              value={row}
              disabled={disabled}
              error={error !== undefined}
              helperText={error}
              onChange={(event) => {
                onChange(rows.map((current, at) => (at === index ? event.target.value : current)));
              }}
              sx={{ flex: '1 1 16rem' }}
            />
            <IconButton
              size="small"
              disabled={disabled}
              // Composed outside `t`: a bundle string wins over a call-site
              // fallback, and a fallback carrying `{{braces}}` renders them
              // literally when the key is missing.
              aria-label={`${t('pages.admin.features.list.remove', 'Remove entry')} ${String(index + 1)} — ${label}`}
              onClick={() => {
                onChange(rows.filter((_, at) => at !== index));
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
          variant="secondary"
          disabled={disabled}
          onClick={() => {
            onChange([...rows, '']);
          }}
          sx={{ textTransform: 'none' }}
        >
          {`${t('pages.admin.features.list.add', 'Add entry')} — ${label}`}
        </Button>
      </Box>
    </Box>
  );
}
