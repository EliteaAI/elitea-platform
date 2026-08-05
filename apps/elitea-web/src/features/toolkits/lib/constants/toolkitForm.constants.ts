/**
 * Ports `apps/elitea-ui/src/[fsd]/features/toolkits/lib/constants/
 * toolkitForm.constants.js` (47 lines, Wave-2 unit A4b) — `ToolEvents` and
 * `ToolTypes`.
 *
 * NOT duplicated here: the Wave-2 promotion pass (Part 2) already ported
 * this exact file byte-for-byte into `entities/toolkit`'s
 * `model/toolForm.ts` (see that file's own doc comment — it explicitly
 * cites this 47-line file, quotes the same `ToolEvents`/`ToolTypes`
 * literals, and confirms it is NOT the unrelated 487-line
 * `pages/Applications/Components/Tools/consts.js` also promoted there).
 * Re-exporting `entities/toolkit`'s copy keeps ONE source of truth for
 * these two catalogues instead of two independently-maintained literals
 * that could drift; `features/` importing `entities/` is a legal downward
 * import (spec §3.2).
 */
export { ToolEvents, ToolTypes } from '@/entities/toolkit';
