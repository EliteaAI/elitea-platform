import { describe, expect, it } from 'vitest';

import {
  categoryHeadline,
  pickItemNoun,
  reportHeadline,
  unchangedNotice,
  visibleCategories,
} from './indexingReport.helpers';
import { normalizeIndexingReport, type IndexingReport } from './indexingReport.serialize';

function reportOf(source: unknown): IndexingReport {
  const report = normalizeIndexingReport(source);
  if (report === null) throw new Error('expected a report');
  return report;
}

describe('pickItemNoun', () => {
  it('singularises at exactly one', () => {
    const labels = { singular: 'page', plural: 'pages' };
    expect(pickItemNoun(1, labels)).toBe('page');
    expect(pickItemNoun(0, labels)).toBe('pages');
    expect(pickItemNoun(2, labels)).toBe('pages');
  });
});

describe('visibleCategories', () => {
  it('drops empty categories and the unchanged group, which the notice already covers', () => {
    const report = reportOf({
      indexed: 10,
      skipped: {
        documents_already_indexed: { count: 3, items: [] },
        documents_skipped: { filtered_count: 2, filtered: ['x.md'] },
      },
    });
    const visible = visibleCategories(report);
    expect(visible.map((category) => category.kind)).toEqual(['indexed', 'skipped']);
    expect(visible[1]?.groups.map((group) => group.reason)).toEqual(['filtered']);
  });

  it('keeps a zero-count category that still carries a dependent group', () => {
    const report = reportOf({ indexed: 0, skipped: { dependent_items_filtered: { count: 4, items: ['a.png'] } } });
    expect(visibleCategories(report).map((category) => category.kind)).toEqual(['skipped']);
  });
});

describe('categoryHeadline', () => {
  it('counts items for a counted category', () => {
    const report = reportOf({ indexed: 1, skipped: { documents_skipped: { filtered_count: 1, filtered: ['x'] } } });
    const skipped = visibleCategories(report).find((category) => category.kind === 'skipped');
    if (skipped === undefined) throw new Error('expected a skipped category');
    expect(categoryHeadline(skipped, report).text).toBe('1 document skipped');
  });

  it('falls back to the dependent count and its own nouns when the category itself counts nothing', () => {
    const report = reportOf({ indexed: 0, skipped: { dependent_items_filtered: { count: 4, items: [] } } });
    const skipped = visibleCategories(report)[0];
    if (skipped === undefined) throw new Error('expected a skipped category');
    expect(categoryHeadline(skipped, report).text).toBe('4 attachments skipped');
  });
});

describe('reportHeadline', () => {
  it('announces a total failure', () => {
    const headline = reportHeadline(reportOf({ state: 'failed', indexed: 0, error: 'boom' }));
    expect(headline).toEqual({ icon: '❌', text: 'Failed to index documents' });
  });

  it('announces an up-to-date run by its unchanged count', () => {
    const report = reportOf({ indexed: 3, skipped: { documents_already_indexed: { count: 3, items: [] } } });
    expect(reportHeadline(report)?.text).toBe('Up to date — 3 documents unchanged');
  });

  it('announces an empty run', () => {
    expect(reportHeadline(reportOf({ indexed: 0 }))?.text).toBe('No documents to index');
  });

  it('says nothing when the categories already tell the story', () => {
    expect(reportHeadline(reportOf({ indexed: 5 }))).toBeNull();
  });
});

describe('unchangedNotice', () => {
  it('restates the unchanged tally that visibleCategories strips out', () => {
    const report = reportOf({
      indexed: 10,
      skipped: { documents_already_indexed: { count: 3, items: [] }, documents_skipped: { filtered_count: 1, filtered: [] } },
    });
    expect(unchangedNotice(report)?.text).toBe('3 documents already indexed (unchanged)');
  });

  it('stays silent when there is nothing unchanged, or when the headline already said it', () => {
    expect(unchangedNotice(reportOf({ indexed: 5 }))).toBeNull();
    expect(unchangedNotice(reportOf({ indexed: 3, skipped: { documents_already_indexed: { count: 3, items: [] } } }))).toBeNull();
    expect(unchangedNotice(null)).toBeNull();
  });
});
