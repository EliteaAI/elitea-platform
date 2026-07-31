// @ts-nocheck
/**
 * AddNewUserModal — modal for adding users to a conversation.
 *
 * Ported from `[fsd]/features/chat/ui/chat-modal/AddNewUserModal.jsx`.
 *
 * Cross-cutting: uses `entities/participant`'s `useParticipants` and
 * `useFilteredEntityItems` for candidate browsing (issue #33, item 8).
 */
import { memo, useCallback, useState } from 'react';

import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';

import { useParticipants } from '@/entities/participant';
import { useSelectedProjectId } from '@/shared/config';

import { t } from '@/shared/ui/lib/t';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface AddNewUserModalProps {
  open: boolean;
  onClose: () => void;
  onAddUsers: (users: Record<string, unknown>[]) => void;
  /** The current participant type filter (applications, pipelines, etc.). */
  types?: string[];
  /** The project filter. */
  projectFilter?: 'all' | 'public' | 'teamProject';
}

/**
 * AddNewUserModal component — modal for browsing and adding users/toolkits/etc.
 * to a conversation.
 */
const AddNewUserModal = memo((props: AddNewUserModalProps): React.ReactElement => {
  const { open, onClose, onAddUsers, types, projectFilter } = props;

  const projectId = useSelectedProjectId();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<Record<string, unknown>[]>([]);

  // Use the entity hook for candidate aggregation
  const { participants: candidates, isLoading } = useParticipants({
    projectId,
    publicProjectId: import.meta.env?.VITE_PUBLIC_PROJECT_ID || '',
    privateProjectId: undefined,
    currentUserId: undefined,
    canListPublicAgents: true,
    query: searchQuery,
    types: types as unknown as Parameters<typeof useParticipants>[0]['types'],
    projectFilter,
    enabled: open,
  });

  const handleSelectUser = useCallback((user: Record<string, unknown>) => {
    setSelectedUsers((prev) => {
      const exists = prev.some((u) => u.id === user.id);
      if (exists) return prev.filter((u) => u.id !== user.id);
      return [...prev, user];
    });
  }, []);

  const handleAddSelected = useCallback(() => {
    onAddUsers(selectedUsers);
    setSelectedUsers([]);
    setSearchQuery('');
    onClose();
  }, [selectedUsers, onAddUsers, onClose]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('chat-participants.modal.title', 'Add Participants')}</DialogTitle>
      <DialogContent>
        <Box sx={{ mb: 2 }}>
          <TextField
            fullWidth
            placeholder={t('chat-participants.modal.search', 'Search participants...')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            size="small"
            autoComplete="off"
          />
        </Box>
        <Box sx={{ maxHeight: 300, overflow: 'auto' }}>
          {isLoading && <Typography variant="body2" color="text.disabled">{t('chat-participants.modal.loading', 'Loading...')}</Typography>}
          {!isLoading && candidates.length === 0 && (
            <Typography variant="body2" color="text.disabled">{t('chat-participants.modal.noResults', 'No participants found')}</Typography>
          )}
          {candidates.map((candidate) => {
            const name = candidate.entity_meta?.name || t('chat-participants.common.unknown', 'Unknown');
            const isSelected = selectedUsers.some((u) => u.id === candidate.id);
            return (
              <Box
                key={candidate.id}
                onClick={() => handleSelectUser(candidate)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  p: 1,
                  borderRadius: 'var(--el-shape-radiusSm, 4px)',
                  cursor: 'pointer',
                  backgroundColor: isSelected ? 'action.selected' : 'transparent',
                  '&:hover': { backgroundColor: 'action.hover' },
                }}
              >
                <Typography variant="body2">{name}</Typography>
                {isSelected && <CheckCircleRounded sx={{ color: 'primary.main' }} />}
              </Box>
            );
          })}
        </Box>
        {selectedUsers.length > 0 && (
          <Box sx={{ mt: 2, p: 1, backgroundColor: 'action.selected', borderRadius: 'var(--el-shape-radiusSm, 4px)' }}>
            {/* eslint-disable-next-line i18next/no-literal-string -- placeholder for i18n interpolation */}
            <Typography variant="body2" sx={{ mb: 0.5 }}>{`${t('chat-participants.modal.selected', 'Selected ({count}):').replace('{count}', '')} ${selectedUsers.length}`}</Typography>
            {selectedUsers.map((u) => (
              <Typography key={u.id} variant="bodySmall" color="text.secondary">
                • {u.entity_meta?.name || t('chat-participants.common.unknown', 'Unknown')}
              </Typography>
            ))}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('chat-participants.modal.cancel', 'Cancel')}</Button>
        <Button
          onClick={handleAddSelected}
          disabled={selectedUsers.length === 0}
          variant="contained"
        >
          {t('chat-participants.modal.addSelected', 'Add Selected')}
        </Button>
      </DialogActions>
    </Dialog>
  );
});

AddNewUserModal.displayName = 'AddNewUserModal';

export default AddNewUserModal;
