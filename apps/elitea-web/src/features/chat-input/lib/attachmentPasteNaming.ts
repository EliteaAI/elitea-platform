/**
 * Two small, pure helpers ported from `apps/elitea-ui/src/common/
 * attachmentValidationUtils.js` — `UserInput.tsx`'s `handlePaste` is the
 * only place this cluster needs them (renaming a just-pasted `File` so two
 * same-named pastes never collide). The REST of that ~300-line file
 * (attachment type/size validation, batch-processing, duplicate-name
 * resolution) belongs to the real `AttachmentButton`'s drop/paste
 * validation pipeline — owned by unit C6 (not built yet, and the very
 * component `slots.attachmentButton` stands in for) — not duplicated here.
 */

/** `attachmentValidationUtils.js`'s `generateRandomAppendix`, ported verbatim. */
export function generateRandomAppendix(fileSize: number): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  const fileSizeKB = (fileSize / 1024).toFixed(2);
  return `${year}${month}${day}_${hours}${minutes}${seconds}_${fileSizeKB}KB`;
}

/** `attachmentValidationUtils.js`'s `renameFile`, ported verbatim. */
export function renameFile(file: File, appendix: string): File {
  const fileName = file.name;
  const lastDotIndex = fileName.lastIndexOf('.');
  const newName =
    lastDotIndex === -1
      ? `${fileName}_${appendix}`
      : `${fileName.substring(0, lastDotIndex)}_${appendix}${fileName.substring(lastDotIndex)}`;
  return new File([file], newName, { type: file.type, lastModified: file.lastModified });
}
