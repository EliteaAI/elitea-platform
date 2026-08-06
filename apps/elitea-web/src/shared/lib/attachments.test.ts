import { describe, expect, it } from 'vitest';

import {
  ATTACHMENT_LIMITS,
  getRemainingAttachmentCapacity,
  validateAttachmentFiles,
} from './attachments';

describe('ATTACHMENT_LIMITS', () => {
  it('preserves the exact byte/count limits (constants.js:1059-1065)', () => {
    expect(ATTACHMENT_LIMITS.MAX_ATTACHMENTS).toBe(10);
    expect(ATTACHMENT_LIMITS.MAX_TOTAL_SIZE).toBe(150 * 1024 * 1024);
    expect(ATTACHMENT_LIMITS.DEFAULT_MAX_FILE_SIZE).toBe(157_286_400);
    expect(ATTACHMENT_LIMITS.MAX_IMAGE_ATTACHMENTS).toBe(10);
    expect(ATTACHMENT_LIMITS.MAX_IMAGE_FILE_SIZE).toBe(5 * 1024 * 1024);
  });
});

function makeFile(name: string, size: number, type = 'application/octet-stream'): File {
  const buf = new ArrayBuffer(size);
  return new File([buf], name, { type });
}

describe('getRemainingAttachmentCapacity', () => {
  it('returns full capacity when no attachments exist', () => {
    const result = getRemainingAttachmentCapacity([]);
    expect(result.remainingAttachments).toBe(10);
    expect(result.isAtMaxCapacity).toBe(false);
    expect(result.isAtMaxSize).toBe(false);
  });

  it('reports isAtMaxCapacity when at the file limit', () => {
    const files = Array.from({ length: 10 }, (_, i) => makeFile(`f${i}.txt`, 100));
    const result = getRemainingAttachmentCapacity(files);
    expect(result.remainingAttachments).toBe(0);
    expect(result.isAtMaxCapacity).toBe(true);
  });

  it('reports isAtMaxSize when total size reaches the limit', () => {
    const file = makeFile('big.bin', ATTACHMENT_LIMITS.MAX_TOTAL_SIZE);
    const result = getRemainingAttachmentCapacity([file]);
    expect(result.isAtMaxSize).toBe(true);
    expect(result.isAtMaxCapacity).toBe(false);
  });

  it('respects custom limits', () => {
    const limits = { MAX_ATTACHMENTS: 2, MAX_TOTAL_SIZE: 500 } as unknown as typeof ATTACHMENT_LIMITS;
    const files = [makeFile('a.txt', 100), makeFile('b.txt', 100)];
    const result = getRemainingAttachmentCapacity(files, limits);
    expect(result.remainingAttachments).toBe(0);
    expect(result.isAtMaxCapacity).toBe(true);
  });
});

describe('validateAttachmentFiles', () => {
  it('accepts valid files within all limits', () => {
    const files = [makeFile('doc.pdf', 1024)];
    const result = validateAttachmentFiles(files, []);
    expect(result.validFiles).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects all files when existing attachments are at max capacity', () => {
    const existing = Array.from({ length: 10 }, (_, i) => makeFile(`e${i}.txt`, 10));
    const result = validateAttachmentFiles([makeFile('new.txt', 10)], existing);
    expect(result.validFiles).toHaveLength(0);
    expect(result.errors[0]).toContain('10-file limit');
  });

  it('stops accepting files mid-batch once slot limit is reached', () => {
    const existing = Array.from({ length: 8 }, (_, i) => makeFile(`e${i}.txt`, 10));
    const newFiles = [makeFile('a.txt', 10), makeFile('b.txt', 10), makeFile('c.txt', 10), makeFile('d.txt', 10)];
    const result = validateAttachmentFiles(newFiles, existing);
    expect(result.validFiles).toHaveLength(2);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('10-file limit');
  });

  it('rejects image files exceeding the image size cap', () => {
    const bigImage = makeFile('photo.png', 6 * 1024 * 1024, 'image/png');
    const result = validateAttachmentFiles([bigImage], []);
    expect(result.validFiles).toHaveLength(0);
    expect(result.errors[0]).toContain('5.0MB');
  });

  it('applies default (non-image) size cap to SVG files', () => {
    const svg = makeFile('icon.svg', 6 * 1024 * 1024, 'image/svg+xml');
    const result = validateAttachmentFiles([svg], []);
    expect(result.validFiles).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects non-image files exceeding the default size cap', () => {
    const huge = makeFile('dump.bin', 151 * 1024 * 1024);
    const result = validateAttachmentFiles([huge], []);
    expect(result.validFiles).toHaveLength(0);
    expect(result.errors[0]).toContain('150.0MB');
  });

  it('enforces the image count limit', () => {
    const existing = Array.from({ length: 10 }, (_, i) => makeFile(`img${i}.jpg`, 100, 'image/jpeg'));
    const newImage = makeFile('extra.png', 100, 'image/png');
    const result = validateAttachmentFiles([newImage], existing, { ...ATTACHMENT_LIMITS, MAX_ATTACHMENTS: 20 } as unknown as typeof ATTACHMENT_LIMITS);
    expect(result.validFiles).toHaveLength(0);
    expect(result.errors[0]).toContain('10 image');
  });

  it('rejects files that would exceed total size', () => {
    const existing = [makeFile('big.bin', 149 * 1024 * 1024)];
    const newFile = makeFile('extra.bin', 2 * 1024 * 1024);
    const result = validateAttachmentFiles([newFile], existing);
    expect(result.validFiles).toHaveLength(0);
    expect(result.errors[0]).toContain('Total size limit');
  });

  it('accumulates multiple errors for different rejection reasons', () => {
    const limits = { ...ATTACHMENT_LIMITS, MAX_ATTACHMENTS: 20 } as unknown as typeof ATTACHMENT_LIMITS;
    const tooBig = makeFile('huge.bin', 200 * 1024 * 1024);
    const tooBigImg = makeFile('huge.png', 10 * 1024 * 1024, 'image/png');
    const result = validateAttachmentFiles([tooBig, tooBigImg], [], limits);
    expect(result.errors).toHaveLength(2);
    expect(result.validFiles).toHaveLength(0);
  });
});
