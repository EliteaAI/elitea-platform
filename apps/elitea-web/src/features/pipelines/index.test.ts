import { describe, expect, it } from 'vitest';

import * as slice from './index';

/**
 * Pins the slice's RUNTIME public surface (spec §3.3: index.ts is the only
 * file other slices may import). `export type` interfaces are erased by
 * `verbatimModuleSyntax` and never appear on the runtime namespace object,
 * so this list is deliberately the value-export subset only. Precedent:
 * `entities/application-form/index.test.ts`.
 */
const PUBLIC_SURFACE = [
  'FStringAutocompletePopper',
  'YamlCodeEditor',
  'useFStringAutocomplete',
  'useFStringInputAutocomplete',
  'PipelineEditor',
  'useEditPipeline',
  'usePipelineCreation',
  'ConfigurationTab',
  // #135 — the read/write halves of pipeline-graph persistence.
  'usePipelineVersionSync',
  'usePipelineGraphDraft',
  // The discard half of the same pair — `EditPipeline`'s Cancel→Discard must
  // drop the in-memory stores or a later Save persists the discarded edits.
  'resetPipelineDraft',
  /*
   * The save veto, for the one consumer that must DISABLE a control on it:
   * `pages/pipelines`' version bar, whose "Save As Version" writes the live
   * graph and so has to obey the same refusal the Save button does.
   *
   * Public because there is no other legal route: `no-deep-slice-import`
   * forbids `pages/**` reaching past this barrel, and the judgement depends
   * on `model/pipelineYamlStore.ts`. The page's OWN save path does not appear
   * here — it gets the same verdict off `usePipelineGraphDraft`'s reader
   * (`PipelineGraphDraft.admission`), which is both one export cheaper
   * against the §3.3 budget of 20 and the only shape that judges the exact
   * string being stored at click time.
   */
  'useLivePipelineGraphAdmission',
] as const;

describe('features/pipelines public surface', () => {
  it('exports exactly the documented runtime set', () => {
    expect(Object.keys(slice).sort()).toEqual([...PUBLIC_SURFACE].sort());
  });
});
