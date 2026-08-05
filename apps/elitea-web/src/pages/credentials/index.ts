/**
 * pages/credentials — route targets for ROUTE-021..025, ROUTE-063..065.
 *
 * Spec §3.3's "index.ts is the only import path" rule applies to
 * `processes/`/`features/`/`entities/`/`widgets/` slices, not `pages/`
 * (route files import a page directly by path). This barrel exists purely
 * as a convenience surface for whoever wires these into `src/routes/**`
 * (outside this unit's ownership fence).
 */
export { CreateCredential } from './CreateCredential';
export type { CreateCredentialProps } from './CreateCredential';
export { CredentialForm } from './CredentialForm';
export type { CredentialFormContext, CredentialFormMode, CredentialFormPrefill, CredentialFormProps } from './CredentialForm';
export { Credentials } from './Credentials';
export type { CredentialsProps } from './Credentials';
export { CredentialsList } from './CredentialsList';
export type { CredentialsListProps } from './CredentialsList';
export { CredentialsTypesPanel } from './CredentialsTypesPanel';
export type { CredentialsTypesPanelProps, CredentialTypeTag } from './CredentialsTypesPanel';
export { CredentialTypeSelector } from './CredentialTypeSelector';
export type { CredentialTypeSelectorProps } from './CredentialTypeSelector';
export { EditCredential } from './EditCredential';
export type { EditCredentialProps } from './EditCredential';
