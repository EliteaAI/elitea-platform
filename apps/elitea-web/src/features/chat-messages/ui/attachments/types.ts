/**
 * Shared types for the chat-messages attachments UI components.
 *
 * Extracted to break a circular dependency: MessageAttachmentList.tsx
 * imports the NormalAttachment component, and NormalAttachment.tsx imports
 * the NormalAttachmentArtifactData type — moving it here creates a DAG.
 */

/** Artifact data passed to the preview callback. */
export interface NormalAttachmentArtifactData {
  /** File path for the attachment. */
  readonly filepath: string;
  /** Artifact type identifier. */
  readonly attachment_type: string;
  /** Storage bucket name. */
  readonly bucket?: string;
}
