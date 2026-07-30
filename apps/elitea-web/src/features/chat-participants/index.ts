/**
 * Chat-participants feature — public API barrel.
 *
 * Port of `apps/elitea-ui/src/[fsd]/features/chat/participants/` (unit C5,
 * 33 files, ~4,685 LOC). This barrel exports only what consumer code needs.
 */

// ── model ──
export {
  ChatParticipantType,
  ParticipantCreationPermissionMap,
  ParticipantEditPermissionMap,
  ATTACHMENT_ALLOWED_TOOLS,
  ValidParticipantEntityNames,
  ActiveParticipantEntityNames,
} from './model/constants';
export type {
  ValidParticipantEntityName,
  ActiveParticipantEntityName,
  AttachmentAllowedTool,
  ParticipantIconMeta,
} from './model/constants';
export type {
  TransformedParticipant,
  TransformedParticipantEntityMeta,
  TransformedParticipantEntitySettings,
  OldAppParticipant,
  ModelItem,
  ModelsResponse,
  ParticipantDetailCacheKey,
  ParticipantStatusFlags,
  ParticipantDetailsContextValue,
} from './model/types';

// ── lib helpers ──
export { isParticipantOKForChat, canParticipantBeActiveInChat, transformParticipant, isParticipantsEqual } from './lib/helpers';

// ── lib hooks ──
export { useFetchParticipantDetails } from './lib/hooks/useFetchParticipantDetails';
export { useParticipantEntityIcon } from './lib/hooks/useParticipantEntityIcon';
export { useParticipantName } from './lib/hooks/useParticipantName';
export { useActiveParticipantDetails } from './lib/hooks/useActiveParticipantDetails';
export { useAddNewParticipants } from './lib/hooks/useAddNewParticipants';

// ── lib context ──
export {
  ParticipantDetailsProvider,
  useParticipantDetailsContext,
} from './lib/context/ParticipantDetailsContext';

// ── UI ──
export type { ParticipantsProps } from './ui/Participants';
export { default as Participants } from './ui/Participants';
export type { ParticipantsWrapperProps } from './ui/ParticipantsWrapper';
export { default as ParticipantsWrapper } from './ui/ParticipantsWrapper';
export { default as ParticipantItem } from './ui/ExpandedParticipants/ParticipantItem';
export { default as ParticipantSection } from './ui/ExpandedParticipants/ParticipantSection';
export { default as ParticipantWarning } from './ui/ExpandedParticipants/ParticipantWarning';
export { default as ExpandedParticipantsList } from './ui/ExpandedParticipants/ExpandedParticipantsList';
export { default as ParticipantsAccordion } from './ui/ExpandedParticipants/ParticipantsAccordion';
export { default as UserParticipantItem } from './ui/ExpandedParticipants/UserParticipantItem';
export { default as ParticipantActions } from './ui/ParticipantActions/ParticipantActions';
export { default as DeleteParticipantButton } from './ui/ParticipantActions/DeleteParticipantButton';
export { default as EditParticipantButton } from './ui/ParticipantActions/EditParticipantButton';
export { default as CollapsedParticipantsDropdown } from './ui/CollapsedParticipants/CollapsedParticipantsDropdown';
export { default as CollapsedParticipantsList } from './ui/CollapsedParticipants/CollapsedParticipantsList';
export { default as UsersParticipantDropdown } from './ui/UsersParticipantDropdown';
export { default as DropdownFooter } from './ui/UsersParticipantDropdown/DropdownFooter';
export { default as UserMenu } from './ui/UsersParticipantDropdown/UserMenu';
export { default as AddNewUserModal } from './ui/chat-modal/AddNewUserModal';

// ── chat hooks ──
export { default as useChangeParticipantSettings } from './hooks/chat/useChangeParticipantSettings';
export { default as useDeleteParticipant } from './hooks/chat/useDeleteParticipant';
export { default as useLocalActiveParticipant } from './hooks/chat/useLocalActiveParticipant';
export { default as useMCPParticipantStatusMonitor } from './hooks/chat/useMCPParticipantStatusMonitor';
export { default as useRemoteParticipantUpdate } from './hooks/chat/useRemoteParticipantUpdate';
