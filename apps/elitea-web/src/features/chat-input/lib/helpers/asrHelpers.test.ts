import { describe, expect, it } from 'vitest';

import { isWhisperModel } from './asrHelpers';

describe('isWhisperModel', () => {
  it('returns false for nullish/empty input', () => {
    expect(isWhisperModel(undefined)).toBe(false);
    expect(isWhisperModel(null)).toBe(false);
    expect(isWhisperModel('')).toBe(false);
  });

  it('matches names containing "whisper" case-insensitively', () => {
    expect(isWhisperModel('whisper-1')).toBe(true);
    expect(isWhisperModel('Whisper-Large-V3')).toBe(true);
    expect(isWhisperModel('WHISPER')).toBe(true);
  });

  it('matches names containing "transcribe" case-insensitively', () => {
    expect(isWhisperModel('gpt-4o-transcribe')).toBe(true);
    expect(isWhisperModel('GPT-4o-Transcribe')).toBe(true);
  });

  it('returns false for a streaming/realtime model name', () => {
    expect(isWhisperModel('gpt-4o-realtime-preview')).toBe(false);
    expect(isWhisperModel('deepgram-nova-2')).toBe(false);
  });
});
