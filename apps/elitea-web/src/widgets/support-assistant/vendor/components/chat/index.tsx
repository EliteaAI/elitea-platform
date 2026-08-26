/*
 * The chat barrel, trimmed to what the widget ROOT mounts.
 *
 * It used to re-export all twelve components. Every other one is imported
 * directly by its sibling now — re-exporting them made each member import the
 * barrel that re-exported it, which is a real import cycle (`import/no-cycle`
 * flagged fourteen) and left knip reporting nine exports nobody used.
 */
export { default as ChatButton } from './ChatButton';
export { default as ChatWindow } from './ChatWindow';
export { default as PopupMessage } from './PopupMessage';
