/**
 * ServicePromptsSection styles.
 */
import type { SxProps, Theme } from '@mui/material/styles';

export const promptsStyles: Record<string, SxProps<Theme>> = {
  wrapper: ({ spacing }) => ({
    display: 'flex',
    flexDirection: 'column',
    gap: spacing(1),
    padding: '0rem 1.5rem',
    width: '100%',
  }),
  cards: ({ spacing }) => ({
    display: 'flex',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing(1.5),
  }),
  card: ({ palette, breakpoints }) => ({
    border: `0.0625rem solid ${palette.border.table}`,
    backgroundColor: palette.background.secondary,
    borderRadius: 'var(--el-shape-radiusMd, 8px)',
    flex: '0 0 calc((100% - 1.5rem) / 3)',
    maxWidth: 'calc((100% - 1.5rem) / 3)',
    [breakpoints.down('lg')]: {
      flex: '0 0 calc((100% - 1.5rem) / 2)',
      maxWidth: 'calc((100% - 1.5rem) / 2)',
    },
    [breakpoints.down('md')]: {
      flex: '0 0 100%',
      maxWidth: '100%',
    },
  }),
  cardContent: ({ spacing }) => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing(2),
    padding: spacing(2),
    minWidth: 0,
  }),
  cardText: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    flex: 1,
  },
  cardHeading: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: 500,
  },
  cardSubheading: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    opacity: 0.7,
  },
  cardPreview: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    opacity: 0.8,
  },
  cardActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.25rem',
    flexShrink: 0,
  },
  editButton: ({ palette }) => ({
    '&:hover svg': {
      fill: palette.icon.fill.secondary,
    },
  }),
  restoreButton: ({ palette }) => ({
    '&:hover svg': {
      fill: palette.icon.fill.secondary,
    },
  }),
  modalBody: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
  },
  keyRow: ({ spacing }) => ({
    padding: spacing(2),
  }),
  editorContainer: ({ palette }) => ({
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    display: 'flex',
    borderBottom: `0.0625rem solid ${palette.border.lines}`,
  }),
  modalFooter: ({ spacing }) => ({
    display: 'flex',
    justifyContent: 'flex-end',
    gap: spacing(1.5),
    padding: spacing(2),
  }),
  modalRestoreWrapper: {
    marginLeft: '1rem',
  },
};
