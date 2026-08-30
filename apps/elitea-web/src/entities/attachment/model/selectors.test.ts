import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getAttachmentDisabledStatus,
  getAttachmentName,
  getImageSource,
  hasUnresolvedFilepath,
} from './selectors';
import type { Attachment, AttachmentGateParticipant, AttachmentGateParticipantDetails } from './types';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getImageSource — attachment.helpers.js:22-35', () => {
  it('reads the resolved url from the "new" list-format content', () => {
    const attachment: Attachment = {
      item_details: { content: [{ type: 'image_url', image_url: { url: 'https://example.com/a.png' } }] },
    };
    expect(getImageSource(attachment)).toBe('https://example.com/a.png');
  });

  it('reads the resolved url from the legacy un-wrapped dict-format content', () => {
    const attachment: Attachment = {
      item_details: { content: { type: 'image_url', image_url: { url: 'https://example.com/legacy.png' } } },
    };
    expect(getImageSource(attachment)).toBe('https://example.com/legacy.png');
  });

  it('skips an unresolved filepath: URL (indexer has not resolved it yet)', () => {
    const attachment: Attachment = {
      item_details: { content: [{ type: 'image_url', image_url: { url: 'filepath:/bucket/a.png' } }] },
    };
    expect(getImageSource(attachment)).toBeNull();
  });

  it('returns null when content has no image_url item at all (e.g. only text)', () => {
    const attachment: Attachment = { item_details: { content: [{ type: 'text' }] } };
    expect(getImageSource(attachment)).toBeNull();
  });

  it('returns null for a record with no item_details/content', () => {
    expect(getImageSource({})).toBeNull();
  });

  it('creates an object URL for a File attachment', () => {
    const spy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    const file = new File(['x'], 'pic.png', { type: 'image/png' });
    expect(getImageSource(file)).toBe('blob:mock-url');
    expect(spy).toHaveBeenCalledWith(file);
  });

  it('passes a bare string attachment through unchanged', () => {
    expect(getImageSource('https://example.com/direct.png')).toBe('https://example.com/direct.png');
  });
});

describe('hasUnresolvedFilepath — attachment.helpers.js:38-42', () => {
  it('is true for a filepath: URL', () => {
    const attachment: Attachment = {
      item_details: { content: [{ type: 'image_url', image_url: { url: 'filepath:/bucket/a.png' } }] },
    };
    expect(hasUnresolvedFilepath(attachment)).toBe(true);
  });

  it('is false for a resolved URL', () => {
    const attachment: Attachment = {
      item_details: { content: [{ type: 'image_url', image_url: { url: 'https://example.com/a.png' } }] },
    };
    expect(hasUnresolvedFilepath(attachment)).toBe(false);
  });

  it('is false when there is no content', () => {
    expect(hasUnresolvedFilepath({})).toBe(false);
  });

  it('is false for a File or string attachment (not a record)', () => {
    expect(hasUnresolvedFilepath(new File(['x'], 'a.png'))).toBe(false);
    expect(hasUnresolvedFilepath('https://example.com/a.png')).toBe(false);
  });
});

describe('getAttachmentName — attachment.helpers.js:44-52', () => {
  it('renders the filename, not the uuid-prefixed object key a stored item carries as its name', () => {
    expect(
      getAttachmentName({ item_details: { name: '0d9e5c1a-2b3c-4d5e-8f90-123456789abc/report.pdf' } }),
    ).toBe('report.pdf');
  });

  it('prefers item_details.name', () => {
    expect(getAttachmentName({ item_details: { name: 'from-item-details.png' }, name: 'top-level.png' })).toBe(
      'from-item-details.png',
    );
  });

  it('falls back to the top-level name when item_details.name is absent', () => {
    expect(getAttachmentName({ name: 'top-level.png' })).toBe('top-level.png');
  });

  it('falls back to the filepath basename when name is absent everywhere', () => {
    expect(getAttachmentName({ item_details: { filepath: '/bucket/nested/photo.jpg' } })).toBe('photo.jpg');
  });

  it('falls back to the literal string "attachment" when nothing is present', () => {
    expect(getAttachmentName({})).toBe('attachment');
  });

  it('reads File.name for a File attachment', () => {
    expect(getAttachmentName(new File(['x'], 'picked.png'))).toBe('picked.png');
  });

  it('does NOT throw for a bare string attachment (disclosed bug fix vs. the baseline)', () => {
    expect(getAttachmentName('https://example.com/a.png')).toBe('attachment');
  });
});

describe('getAttachmentDisabledStatus — attachment.helpers.js getAttachmentDisabledStatus', () => {
  it('is false (always enabled) when there is no participant', () => {
    expect(getAttachmentDisabledStatus(undefined, undefined)).toBe(false);
    expect(getAttachmentDisabledStatus(null, null)).toBe(false);
  });

  it('is false (always enabled) for an llm/model participant, regardless of internal_tools', () => {
    const participant: AttachmentGateParticipant = { entity_name: 'llm' };
    expect(getAttachmentDisabledStatus(participant, undefined)).toBe(false);
  });

  it('is false (always enabled) for a dummy/user participant', () => {
    expect(getAttachmentDisabledStatus({ entity_name: 'dummy' }, undefined)).toBe(false);
    expect(getAttachmentDisabledStatus({ entity_name: 'user' }, undefined)).toBe(false);
  });

  it('is false for an application participant whose internal_tools includes "attachments"', () => {
    const participant: AttachmentGateParticipant = { entity_name: 'application' };
    const details: AttachmentGateParticipantDetails = { version_details: { meta: { internal_tools: ['attachments'] } } };
    expect(getAttachmentDisabledStatus(participant, details)).toBe(false);
  });

  it('is true for an application participant whose internal_tools omits "attachments"', () => {
    const participant: AttachmentGateParticipant = { entity_name: 'application' };
    const details: AttachmentGateParticipantDetails = { version_details: { meta: { internal_tools: ['other_tool'] } } };
    expect(getAttachmentDisabledStatus(participant, details)).toBe(true);
  });

  it('is true for a pipeline participant with no participantDetails at all', () => {
    const participant: AttachmentGateParticipant = { entity_name: 'pipeline' };
    expect(getAttachmentDisabledStatus(participant, undefined)).toBe(true);
  });

  it('is true for an application participant whose version_details.meta is entirely absent', () => {
    const participant: AttachmentGateParticipant = { entity_name: 'application' };
    expect(getAttachmentDisabledStatus(participant, {})).toBe(true);
  });
});
