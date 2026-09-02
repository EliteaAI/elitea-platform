/**
 * The DeepWiki fixtures parse, match the shapes elitea-main actually returns,
 * and agree with each other.
 *
 * WHY THIS EXISTS BEFORE ITS CONSUMERS. The `entities/wiki` slice lands in
 * P2.P1; these fixtures land in P0 so the slice has something recorded to build
 * against. A fixture with no consumer and no test is dead weight that reads as
 * coverage, and knip does not see JSON, so nothing else would notice.
 *
 * THE THIRD ASSERTION IS THE ONE THAT MATTERS. The wiki browser lists objects
 * and then reads the pages the manifest names. If the listing omits a named
 * page, the browser shows a wiki whose pages 404 — and a fixture pair that
 * disagrees would make DWIKI-002 and DWIKI-003 pass against an inconsistency
 * the real store would never produce. That is not hypothetical: the first draft
 * of these fixtures listed two of the manifest's five pages.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import wikiManifest200 from './wiki-manifest.200.json';
import wikiObjectList200 from './wiki-object-list.200.json';
import wikiPage200 from './wiki-page.200.json';
import wikiPageBrokenMermaid200 from './wiki-page-broken-mermaid.200.json';

/**
 * elitea-main's ListObjects envelope (objects.go). Mirrored rather than
 * imported, because the point is to catch a fixture drifting away from the
 * route — importing the app's own parser would let both drift together.
 */
const objectListBody = z.object({
  common_prefixes: z.array(z.string()),
  objects: z.array(
    z.object({
      key: z.string().min(1),
      size_bytes: z.number().int().nonnegative(),
      media_type: z.string().min(1),
      etag: z.string().min(1),
      modified_at: z.string().min(1),
    }),
  ),
});

const wikiManifestBody = z.object({
  schema_version: z.literal(2),
  wiki_id: z.string().min(1),
  wiki_title: z.string().min(1),
  wiki_version_id: z.string().min(1),
  repository: z.string().min(1),
  branch: z.string().min(1),
  pages: z.array(z.string().min(1)).min(1),
});

describe('DeepWiki fixtures', () => {
  it('the object listing matches elitea-main ListObjects', () => {
    expect(() => objectListBody.parse(wikiObjectList200.body)).not.toThrow();
  });

  it('the wiki manifest matches the recorded provider shape', () => {
    expect(() => wikiManifestBody.parse(wikiManifest200.body)).not.toThrow();
  });

  it('every page the manifest names is present in the object listing', () => {
    const listed = new Set(wikiObjectList200.body.objects.map((o) => o.key));
    const missing = wikiManifest200.body.pages.filter((page) => !listed.has(page));
    expect(missing).toEqual([]);
  });

  it('the page fixture carries a mermaid block, so the quick-fix items have an input', () => {
    expect(wikiPage200.body).toContain('```mermaid');
  });

  it('the broken-mermaid fixture is actually different from the good one', () => {
    // Both carry a mermaid fence; if they were the same document the quick-fix
    // tests would exercise the success path twice and report it as coverage of
    // the failure path.
    expect(wikiPageBrokenMermaid200.body).toContain('```mermaid');
    expect(wikiPageBrokenMermaid200.body).not.toEqual(wikiPage200.body);
  });

  it('no fixture speaks the legacy artifact path family', () => {
    // parity/notes/deepwiki-artifact-store.md: elitea-main serves no
    // /api/v2/artifacts/artifact(s)/default/... route. A fixture recorded
    // against that family would encode a 404 as if it were a contract.
    const everything = JSON.stringify([
      wikiObjectList200,
      wikiManifest200,
      wikiPage200,
      wikiPageBrokenMermaid200,
    ]);
    expect(everything).not.toMatch(/artifacts\/artifacts?\/default/);
  });
});
