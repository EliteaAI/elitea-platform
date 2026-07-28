import { describe, expect, it } from 'vitest';

import { mapAssociationError } from './associationError';

describe('mapAssociationError', () => {
  describe('circular/cycle branch', () => {
    it('add (default action)', () => {
      expect(mapAssociationError('circular reference detected', 'Bot A')).toBe(
        'Cannot add "Bot A": this would create a circular agent reference. Remove the circular dependency first.',
      );
    });

    it('switch, with a version label', () => {
      const message = mapAssociationError('this creates a cycle', 'Bot A', {
        action: 'switch',
        versionLabel: 'base – 06.07.2026',
      });
      expect(message).toBe(
        'Cannot switch "Bot A" to version base – 06.07.2026: this agent version is already in the chain and would create a circular reference. Choose a different version or remove the circular reference first.',
      );
    });

    it('switch, without a version label omits the "to version" phrase', () => {
      const message = mapAssociationError('cycle', 'Bot A', { action: 'switch' });
      expect(message).toBe(
        'Cannot switch "Bot A": this agent version is already in the chain and would create a circular reference. Choose a different version or remove the circular reference first.',
      );
    });

    it('status, with entityLabel pipeline', () => {
      const message = mapAssociationError('circular', 'Flow A', { action: 'status', entityLabel: 'pipeline' });
      expect(message).toBe(
        'Cannot use "Flow A": this pipeline is now part of a circular reference in the agent chain. Point it to a version that isn\'t already in the chain, or remove it.',
      );
    });
  });

  describe('sub-agent/nesting branch', () => {
    it.each(['uses other agents', 'cannot be nested', 'has a sub-agent tool'])('matches %s (add)', (fragment) => {
      const message = mapAssociationError(fragment, 'Bot A');
      expect(message).toContain('Tip: make a version of it without sub-agents its default');
    });

    it('switch phrasing names "that version"', () => {
      const message = mapAssociationError('uses other agents', 'Bot A', { action: 'switch' });
      expect(message).toBe(
        'Cannot switch "Bot A": that version uses other agents and can only run directly as a chat participant, not as a sub-agent tool. Choose a leaf version instead.',
      );
    });

    it('status phrasing says "it now uses"', () => {
      const message = mapAssociationError('uses other agents', 'Bot A', { action: 'status' });
      expect(message).toBe(
        'Cannot use "Bot A": it now uses other agents, so it can only run directly as a chat participant, not as a sub-agent tool. Replace it with a leaf version.',
      );
    });
  });

  describe('bind-itself branch', () => {
    it('add', () => {
      expect(mapAssociationError('cannot bind to itself', 'Bot A')).toBe('Cannot add "Bot A" to itself.');
    });

    it('switch', () => {
      expect(mapAssociationError('bind itself', 'Bot A', { action: 'switch' })).toBe(
        'Cannot switch "Bot A": a version cannot reference itself.',
      );
    });

    it('status', () => {
      expect(mapAssociationError('bind itself', 'Bot A', { action: 'status', entityLabel: 'pipeline' })).toBe(
        'Cannot use "Bot A": a pipeline cannot reference itself.',
      );
    });
  });

  describe('fallback', () => {
    it('returns the raw string message unchanged when no known pattern matches', () => {
      expect(mapAssociationError('some other backend error', 'Bot A')).toBe('some other backend error');
    });

    it('routes a non-string error through buildErrorMessage and stringifies the result', () => {
      const message = mapAssociationError({ status: 500, data: { message: 'boom' } }, 'Bot A');
      expect(message).toBe('boom');
    });

    it('never throws on a fully empty/unknown error shape', () => {
      expect(() => mapAssociationError(undefined, 'Bot A')).not.toThrow();
    });
  });

  it('is case-insensitive when matching backend fragments', () => {
    expect(mapAssociationError('CIRCULAR reference', 'Bot A')).toContain('circular agent reference');
  });
});
