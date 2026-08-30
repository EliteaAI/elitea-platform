import { describe, expect, it } from 'vitest';

import { NodeHeightMap, PipelineNodeTypes } from '../constants/flowEditor.constants';

import { NODE_CARD_WIDTH } from './flowEditor.helpers';
import { NEW_NODE_REVEAL_MARGIN, NEW_NODE_REVEAL_MIN_ZOOM, calculateRevealCenterForNewNode } from './newNodeReveal.helpers';

const editor = { width: 800, height: 600 };
const identityViewport = { x: 0, y: 0, zoom: 1 };
const AGENT_HEIGHT = NodeHeightMap[PipelineNodeTypes.Agent]!;

describe('calculateRevealCenterForNewNode', () => {
  it('returns null — i.e. does NOT move the viewport — when the new card already fits on screen', () => {
    // 460x460 card at (170,100) inside an 800x600 canvas, margins to spare.
    expect(calculateRevealCenterForNewNode({ x: 170, y: 100 }, PipelineNodeTypes.Agent, identityViewport, editor)).toBeNull();
  });

  it('centres on a card that runs off the bottom (the End-node stacking case), keeping the current zoom', () => {
    // The only node on a fresh canvas is `End` at the viewport centre, so
    // `calculatePositionForNewNode` stacks the first added card below it and
    // most of that 460px card falls under a 600px fold.
    expect(calculateRevealCenterForNewNode({ x: 170, y: 200 }, PipelineNodeTypes.Agent, identityViewport, editor)).toEqual({
      x: 170 + NODE_CARD_WIDTH / 2,
      y: 200 + AGENT_HEIGHT / 2,
      zoom: 1,
    });
  });

  it('centres on a card placed off the top or the left', () => {
    expect(calculateRevealCenterForNewNode({ x: -900, y: -900 }, PipelineNodeTypes.Agent, identityViewport, editor)).toEqual({
      x: -900 + NODE_CARD_WIDTH / 2,
      y: -900 + AGENT_HEIGHT / 2,
      zoom: 1,
    });
  });

  it('accounts for the current pan instead of assuming an identity viewport', () => {
    // Same node, but the user has panned the canvas so the card sits on screen.
    expect(calculateRevealCenterForNewNode({ x: 170, y: 200 }, PipelineNodeTypes.Agent, { x: -100, y: -140, zoom: 1 }, editor)).toBeNull();
  });

  /**
   * THE REGRESSION THIS FILE EXISTS FOR. A fresh pipeline's initial `fitView`
   * runs against a graph of one small `End` node, so React Flow settles at
   * its `maxZoom` (2). A 460x460 card drawn at 2x overflows an 800x600 pane
   * in both axes — panning alone would still show only the card's header row.
   */
  it('zooms OUT far enough to fit a card that the current (fitView-inflated) zoom cannot show', () => {
    const target = calculateRevealCenterForNewNode({ x: 170, y: 200 }, PipelineNodeTypes.Agent, { x: 0, y: 0, zoom: 2 }, editor);

    expect(target!.zoom).toBeLessThan(2);
    // The binding axis is the shorter one: (600 - 48) / 460.
    expect(target!.zoom).toBeCloseTo((editor.height - 2 * NEW_NODE_REVEAL_MARGIN) / AGENT_HEIGHT, 10);
    // And at that zoom the whole card really does fit the pane.
    expect(NODE_CARD_WIDTH * target!.zoom).toBeLessThanOrEqual(editor.width - 2 * NEW_NODE_REVEAL_MARGIN);
    expect(AGENT_HEIGHT * target!.zoom).toBeLessThanOrEqual(editor.height - 2 * NEW_NODE_REVEAL_MARGIN);
  });

  it('never zooms IN on a user who deliberately zoomed out', () => {
    const target = calculateRevealCenterForNewNode({ x: 5000, y: 5000 }, PipelineNodeTypes.Agent, { x: 0, y: 0, zoom: 0.6 }, editor);

    expect(target!.zoom).toBe(0.6);
  });

  it('does not propose a zoom React Flow would clamp away', () => {
    // A tiny pane: the fit would want ~0.1, which is below the default minZoom.
    const target = calculateRevealCenterForNewNode({ x: 0, y: 0 }, PipelineNodeTypes.Agent, identityViewport, { width: 120, height: 120 });

    expect(target!.zoom).toBe(NEW_NODE_REVEAL_MIN_ZOOM);
  });

  it('falls back to the default card height for an unknown node type', () => {
    expect(calculateRevealCenterForNewNode({ x: 170, y: 300 }, 'not-a-real-node-type', identityViewport, editor)).toEqual({
      x: 170 + NODE_CARD_WIDTH / 2,
      y: 300 + 250,
      // 500 tall still fits an 800x600 pane at 1x, so the current zoom stands.
      zoom: 1,
    });
  });

  it('does not move the viewport when the canvas has not been measured yet', () => {
    expect(calculateRevealCenterForNewNode({ x: 0, y: 0 }, PipelineNodeTypes.Agent, identityViewport, { width: 0, height: 0 })).toBeNull();
    expect(calculateRevealCenterForNewNode({ x: 0, y: 0 }, PipelineNodeTypes.Agent, { x: 0, y: 0, zoom: 0 }, editor)).toBeNull();
  });
});
