import { describe, expect, it } from 'vitest';

import type { Attachment } from '@/entities/attachment';

import { attachmentDeleteKey, planAttachmentDownload } from './imageAttachment.helpers';

/**
 * `bucket` is a real wire field entities/attachment's own `AttachmentItemDetails`
 * deliberately does not model (see that slice's model/types.ts doc comment,
 * and `imageAttachment.helpers.ts`'s own `StoredItemDetails`/`storedItemDetails`
 * doc comments for the full rationale). Building the fixture through this
 * typed-parameter indirection (rather than an inline `{ item_details: {...
 * bucket: ... } }` literal typed as `Attachment`) sidesteps TS's excess-
 * property check on fresh literals — no cast needed, since `itemDetails`
 * here is a pre-typed variable, not a literal, by the time it reaches the
 * `item_details:` property.
 */
function fixture(itemDetails: { name?: string; filepath?: string; bucket?: string }): Attachment {
  return { item_details: itemDetails };
}

describe('attachmentDeleteKey', () => {
  it('prefers item_details.filepath over item_details.name and attachment.name', () => {
    expect(
      attachmentDeleteKey({ item_details: { filepath: '/bucket/a.png', name: 'a.png' }, name: 'top-level.png' }),
    ).toBe('/bucket/a.png');
  });

  it('falls back to item_details.name when filepath is absent', () => {
    expect(attachmentDeleteKey({ item_details: { name: 'a.png' } })).toBe('a.png');
  });

  it('falls back to the top-level name when item_details is absent', () => {
    expect(attachmentDeleteKey({ name: 'top-level.png' })).toBe('top-level.png');
  });

  it('treats an empty-string filepath as absent (matches the baseline\'s truthy `||` chain)', () => {
    expect(attachmentDeleteKey({ item_details: { filepath: '', name: 'a.png' } })).toBe('a.png');
  });

  it('reads File.name for a raw File attachment', () => {
    const file = new File(['x'], 'picked.png', { type: 'image/png' });
    expect(attachmentDeleteKey(file)).toBe('picked.png');
  });

  it('returns undefined for a bare string attachment', () => {
    expect(attachmentDeleteKey('https://example.com/a.png')).toBeUndefined();
  });

  it('returns undefined when no field resolves at all', () => {
    expect(attachmentDeleteKey({})).toBeUndefined();
  });
});

describe('planAttachmentDownload', () => {
  it('routes to artifact storage for a real filepath with a real bucket', () => {
    expect(planAttachmentDownload(fixture({ filepath: '/bucket/a.png', bucket: 'bucket' }))).toEqual({
      kind: 'artifact-storage',
      filepath: '/bucket/a.png',
    });
  });

  it('routes to the legacy branch when the bucket is the "__undefined__" sentinel', () => {
    expect(planAttachmentDownload(fixture({ filepath: '/bucket/a.png', bucket: '__undefined__' }))).toEqual({
      kind: 'legacy-base64',
    });
  });

  it('routes to the legacy branch when there is no filepath at all', () => {
    expect(planAttachmentDownload({ item_details: { name: 'a.png' } })).toEqual({ kind: 'legacy-base64' });
  });

  it('routes to the legacy branch for a File attachment', () => {
    const file = new File(['x'], 'picked.png', { type: 'image/png' });
    expect(planAttachmentDownload(file)).toEqual({ kind: 'legacy-base64' });
  });

  it('routes to the legacy branch for a bare string attachment', () => {
    expect(planAttachmentDownload('https://example.com/a.png')).toEqual({ kind: 'legacy-base64' });
  });
});
