import { describe, expect, it } from 'vitest';

import { allStuffEmptyMessage, applicationsEmptyMessage, toolsEmptyMessage } from './empty-copy';

describe('allStuffEmptyMessage (parity: AllStuffList.jsx:23-32)', () => {
  it('shows the author-specific message when there is no query', () => {
    expect(allStuffEmptyMessage(false, 'Ada')).toBe('Ada has not created anything yet.');
  });

  it('shows "Nothing found." when a query is active', () => {
    expect(allStuffEmptyMessage(true, 'Ada')).toBe('Nothing found.');
  });
});

describe('applicationsEmptyMessage (parity: ApplicationsList.jsx:18-29)', () => {
  it('says "agent" for the applications tab with no query', () => {
    expect(applicationsEmptyMessage(false, 'Ada', false)).toBe('Ada has not created agent yet.');
  });

  it('says "pipeline" for the pipelines tab with no query', () => {
    expect(applicationsEmptyMessage(false, 'Ada', true)).toBe('Ada has not created pipeline yet.');
  });

  it('shows "Nothing found." when a query is active, regardless of forPipeline', () => {
    expect(applicationsEmptyMessage(true, 'Ada', true)).toBe('Nothing found.');
    expect(applicationsEmptyMessage(true, 'Ada', false)).toBe('Nothing found.');
  });
});

describe('toolsEmptyMessage (parity: AuthorEmptyListPlaceHolder.jsx:7-15)', () => {
  it('shows the author-specific message when there is no query', () => {
    expect(toolsEmptyMessage(false, 'Ada')).toBe('Ada has not created any tools yet.');
  });

  it('shows "Nothing found." when a query is active', () => {
    expect(toolsEmptyMessage(true, 'Ada')).toBe('Nothing found.');
  });
});
