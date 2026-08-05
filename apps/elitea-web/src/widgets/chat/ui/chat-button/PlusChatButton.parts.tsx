/**
 * JSX subcomponents for `PlusChatButton.tsx` — split out purely to keep
 * that component under the §3.5 cyclomatic-complexity-12 budget (each of
 * these is its own function scope, so its internal branches/`.map` don't
 * count toward the composition root's complexity) and file-length-400
 * budget. See `PlusChatButton.helpers.ts` for the pure (non-JSX) helpers.
 */
import type { ReactNode } from 'react';

import Box from '@mui/material/Box';
import type { Theme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';

import { AttachmentButton } from './AttachmentButton';
import type { MenuItemDef, SubmenuKey } from './PlusChatButton.helpers';

export interface AttachmentsPanelProps {
  readonly disableAttachments: boolean;
  readonly attachments: readonly File[];
  readonly onAttachFiles: (files: readonly File[]) => void;
  readonly limits: Record<string, number>;
}

export function AttachmentsPanel({
  disableAttachments,
  attachments,
  onAttachFiles,
  limits,
}: AttachmentsPanelProps): ReactNode {
  return (
    <Box sx={{ padding: '0.5rem' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, padding: '0.375rem 0.5rem' }}>
        <AttachmentButton
          disableAttachments={disableAttachments}
          attachments={attachments}
          onAttachFiles={onAttachFiles}
          limits={limits}
        />
        <Typography variant="bodyMedium">{t('widgets.chat.plusChatButton.attachFilesLabel', 'Attach files')}</Typography>
      </Box>
      {attachments.length > 0 && (
        <Box sx={{ maxHeight: '12rem', overflowY: 'auto' }}>
          {attachments.map((file, i) => (
            <Typography
              key={`${file.name}-${i}`}
              variant="bodySmall"
              component="div"
              sx={{ padding: '0.375rem 0.5rem', color: 'text.secondary' }}
            >
              {file.name}
            </Typography>
          ))}
        </Box>
      )}
    </Box>
  );
}

export interface MainMenuListProps {
  readonly items: readonly MenuItemDef[];
  readonly onBack: () => void;
  readonly onSelectSubmenu: (key: SubmenuKey) => void;
}

export function MainMenuList({ items, onBack, onSelectSubmenu }: MainMenuListProps): ReactNode {
  return (
    <Box>
      {/* Back button header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          padding: '0.5rem 1rem',
          borderBottom: '0.0625rem solid',
          borderColor: 'border.lines',
          cursor: 'pointer',
          color: 'text.secondary',
        }}
        onClick={onBack}
      >
        <Typography variant="bodyMedium" sx={{ flex: 1 }}>
          {t('widgets.chat.plusChatButton.addToChatLabel', 'Add to chat')}
        </Typography>
      </Box>

      {/* Menu items */}
      {items.map((item) => (
        <Box
          key={item.key}
          role="menuitem"
          tabIndex={0}
          sx={(theme: Theme) => ({
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            padding: '0.5rem 1rem',
            height: '2.75rem',
            cursor: 'pointer',
            color: theme.vars.palette.text.secondary,
            '&:hover': {
              backgroundColor: theme.vars.palette.action.hover,
            },
          })}
          onClick={() => item.submenu && onSelectSubmenu(item.submenu)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (item.submenu) onSelectSubmenu(item.submenu);
            }
          }}
        >
          <Typography variant="labelMedium" sx={{ flex: 1 }}>{item.label}</Typography>
          <Typography
            variant="bodySmall"
            sx={(theme: Theme) => ({
              opacity: 0.5,
              color: theme.vars.palette.text.disabled,
            })}
          >
            ›
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
