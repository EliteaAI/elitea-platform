/**
 * Brings a newly added node into view after `calculatePositionForNewNode`
 * has chosen where to put it (`./flowEditor.helpers.ts`).
 *
 * WHY THIS EXISTS: a pipeline canvas is never empty — an `End` node is
 * always present near the viewport centre — so the FIRST node a user adds
 * always overlaps it and is therefore stacked BELOW it by the placement
 * rule. At a typical viewport height most of that card (its body, and the
 * node's own admission alert) then falls below the fold, and the editor
 * used to leave the viewport where it was: "Add node" appeared to do
 * almost nothing.
 *
 * WHY NOT `fitView`: `fitView` rescales the WHOLE canvas to the whole
 * graph on every add, throwing away a zoom level and a pan the user chose
 * deliberately even when nothing needed to move. This instead leaves the
 * viewport completely alone whenever the new card is already fully on
 * screen, and otherwise moves the minimum: it centres on the NEW CARD
 * only, and keeps the current zoom unless that zoom cannot fit the card.
 *
 * WHY THE ZOOM IS NOT SIMPLY PRESERVED: on a fresh pipeline the initial
 * `fitView` runs against a graph of one small `End` node, so React Flow
 * settles at its `maxZoom`. A 460x460 card drawn at that scale overflows
 * the pane in BOTH axes, so a pan alone still showed only the card's
 * header row — the exact symptom this exists to fix. The target zoom is
 * therefore `min(current, whatever fits the card)`: it only ever zooms
 * OUT, and only far enough for the one new card.
 *
 * Pure: it computes a target centre + zoom and returns `null` for "no
 * move needed", so the decision is unit-testable without a React Flow
 * instance.
 */
import { NodeHeightMap } from '../constants/flowEditor.constants';

import { NODE_CARD_WIDTH } from './flowEditor.helpers';

/** Height assumed for a node type `NodeHeightMap` does not cover — the same fallback `flowEditor.helpers.ts` uses. */
const DEFAULT_NODE_CARD_HEIGHT = 500;
/** Screen-space breathing room required around the new card before it counts as "in view". */
export const NEW_NODE_REVEAL_MARGIN = 24;
/**
 * How long to wait after the add before measuring the pane and moving.
 *
 * Not cosmetic: adding an inadmissible node opens the graph-admission panel
 * in the configuration column, which RE-FLOWS the canvas — the pane is
 * ~110px narrower a moment after the add than it was during it. Measuring
 * live after that settles is what makes the card land inside the pane the
 * user actually ends up looking at. Same 100ms the editor's other reveals
 * (`FlowEditor.tsx`'s `setTimeout(fitViewVoid, 100)`) already use.
 */
export const NEW_NODE_REVEAL_DELAY_MS = 100;
/** React Flow's own default `minZoom`; zooming out past it is not something `setCenter` would honour. */
export const NEW_NODE_REVEAL_MIN_ZOOM = 0.5;

interface FlowViewport {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

interface EditorSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Returns the viewport target (`setCenter` args) that brings the newly
 * placed card into view, or `null` when the card already fits on screen
 * (with `NEW_NODE_REVEAL_MARGIN` to spare) and the viewport must not move.
 *
 * `zoom` is never larger than the caller's current zoom: a user who zoomed
 * OUT to see the whole graph is not yanked back in.
 */
export const calculateRevealCenterForNewNode = (
  nodePosition: { readonly x: number; readonly y: number },
  nodeType: string | undefined,
  viewport: FlowViewport,
  editor: EditorSize,
): { x: number; y: number; zoom: number } | null => {
  // An unmeasured canvas (the resize observer has not fired yet) gives no
  // basis to decide visibility; moving the viewport on a guess would be
  // worse than leaving it, so this reports "nothing to do".
  if (editor.width <= 0 || editor.height <= 0 || viewport.zoom <= 0) return null;

  const cardHeight = NodeHeightMap[nodeType ?? ''] ?? DEFAULT_NODE_CARD_HEIGHT;
  const left = nodePosition.x * viewport.zoom + viewport.x;
  const top = nodePosition.y * viewport.zoom + viewport.y;
  const right = left + NODE_CARD_WIDTH * viewport.zoom;
  const bottom = top + cardHeight * viewport.zoom;

  const fullyVisible =
    left >= NEW_NODE_REVEAL_MARGIN &&
    top >= NEW_NODE_REVEAL_MARGIN &&
    right <= editor.width - NEW_NODE_REVEAL_MARGIN &&
    bottom <= editor.height - NEW_NODE_REVEAL_MARGIN;

  if (fullyVisible) return null;

  const availableWidth = editor.width - 2 * NEW_NODE_REVEAL_MARGIN;
  const availableHeight = editor.height - 2 * NEW_NODE_REVEAL_MARGIN;
  // Zoom OUT only, and never below React Flow's own default `minZoom` —
  // past that `setCenter` would clamp it anyway and the returned number
  // would describe a viewport that never happens.
  const zoom = Math.max(NEW_NODE_REVEAL_MIN_ZOOM, Math.min(viewport.zoom, availableWidth / NODE_CARD_WIDTH, availableHeight / cardHeight));

  return { x: nodePosition.x + NODE_CARD_WIDTH / 2, y: nodePosition.y + cardHeight / 2, zoom };
};
