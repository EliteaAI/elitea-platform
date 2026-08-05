/**
 * OLD (pre-namespace) localStorage/sessionStorage key literals ported from
 * apps/elitea-ui/src/common/constants.js:664-668,982-983 (unit S3, spec
 * §9.3).
 *
 * These are the SOURCE key names for unit X5's one-shot migration
 * (`src/shared/lib/storageMigration.ts`, spec §9.3 Wave 3: "One-shot copy of
 * `elitea_ui.project.id`, `elitea_ui.project.name`, `mode` into `el.*`").
 * They are deliberately NOT the new `el.*` namespace (that is
 * `shared/lib/storage.ts`, unit F4, already landed) — kept here, tested,
 * so X5 has one verified source instead of re-typing the literals.
 *
 * `PinnedConversationListKey` (old `constants.js:982`) was found to have
 * zero consumers anywhere in the old app and is DEAD CODE — not ported; see
 * the S3 report.
 *
 * `VoiceConfigStorageKey` (old `useVoiceConfig.hooks.js`'s own hand-rolled
 * `STORAGE_KEY`, not `common/constants.js` — the baseline scattered this
 * one outside the shared constants file) was a real, confirmed gap: added
 * by Wave-2 unit C3 alongside its port of that hook to
 * `features/chat-input/lib/hooks/useVoiceConfig.hooks.ts` (which stores
 * under the NEW `el.*` namespace instead — see that file's own doc
 * comment), so a leftover un-namespaced `elitea_voice_config` value from
 * the old app is still on this migration/cleanup list.
 */
export const ProjectIdStorageKey = 'elitea_ui.project.id';
export const ProjectNameStorageKey = 'elitea_ui.project.name';
export const PublicPermissionStorageKey = 'elitea_ui.public_permission';
export const PermissionStorageKey = 'elitea_ui.project_permission';
export const SoundNotificationsStorageKey = 'elitea_ui.sound_notifications';
export const ActiveConversationParticipantKey = 'ActiveConversationParticipantKey';
export const VoiceConfigStorageKey = 'elitea_voice_config';
