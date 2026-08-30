/**
 * The editor's read of `lib/graphAdmission.helpers.ts` — one admission pass
 * per document, shared by every node panel and by the save gate.
 *
 * **Why a cache and not a plain `useMemo`.** Every node card asks for its
 * own issues, so a `useMemo` per card runs a whole-graph pass per card
 * (O(n²) over the canvas on every keystroke). The document is replaced
 * immutably on every edit, so a `WeakMap` keyed by the document object is
 * both correct and self-invalidating: a new document is a cache miss, the
 * old one is collectable.
 *
 * **Why the empty-DOCUMENT guard is load-bearing, and why it is not an
 * empty-GRAPH guard.** An ABSENT document is not an invalid pipeline — it
 * is an editor that has not been seeded yet (`usePipelineVersionSync` runs
 * after the first paint, and the chat-side editor may never mount one).
 * Reporting "a pipeline must hold between 1 and 128 nodes" there would
 * block the Save button on a screen the user has not touched.
 *
 * A NODE-LESS document is a different thing entirely, and suppressing it
 * was a hole: deleting the last node on the canvas leaves `{state: {...},
 * nodes: [], entry_point: undefined}` — a real, edited document that
 * `PipelineDefinition::from_yaml` refuses twice over (`entry_point` is a
 * required non-defaulted field, `compiler.rs:137`; and `compiler.rs:459`
 * refuses `raw.nodes.is_empty()`). Exempting it re-enabled Save on a graph
 * the runtime cannot run, and `usePipelineGraphDraft` then stored it
 * happily, because its own bail-out reads `yamlCode.trim() === ''` — the
 * top-level `state:` keys survive a delete-all, so that string is never
 * empty. The guard below is the document-shaped reading of the SAME line:
 * an unseeded editor holds `{}` (`pipelineYamlStore.ts`'s
 * `EMPTY_YAML_OBJECT`, the object a blank `yamlCode` parses to), an edited
 * one always holds at least one key.
 */
import { useContext } from 'react';

import { FlowEditorContext } from '../../lib/flow-editor/flowEditorContext';
import type { YamlPipelineDocument } from '../../lib/flow-editor/helpers/pipelineFlow.types';
import { collectGraphAdmissionIssues, issuesForNode } from '../../lib/graphAdmission.helpers';
import type { GraphAdmissionIssue } from '../../lib/graphAdmission.types';
import { usePipelineYamlStore } from '../../model/pipelineYamlStore';

const NO_ISSUES: readonly GraphAdmissionIssue[] = [];

const ISSUE_CACHE = new WeakMap<object, readonly GraphAdmissionIssue[]>();

/**
 * `true` once the editor holds a document at all — a node-less one counts.
 * See this module's doc comment: only a document that was never seeded is
 * exempt, because a node-less one is a real edit the compiler refuses.
 */
function holdsDocument(document: YamlPipelineDocument | undefined): document is YamlPipelineDocument {
  return document !== undefined && Object.keys(document).length > 0;
}

/** Admission issues for `document`, computed once per document object. */
function admissionIssuesFor(document: YamlPipelineDocument | undefined): readonly GraphAdmissionIssue[] {
  if (!holdsDocument(document)) return NO_ISSUES;
  const cached = ISSUE_CACHE.get(document);
  if (cached !== undefined) return cached;
  const issues = collectGraphAdmissionIssues(document);
  ISSUE_CACHE.set(document, issues);
  return issues;
}

export interface GraphAdmission {
  /** Every reason the native runtime would refuse this graph. Empty for an admissible — or not-yet-seeded — document. */
  readonly issues: readonly GraphAdmissionIssue[];
  /**
   * `false` only while the editor holds no DOCUMENT at all; nothing should
   * be gated on admission then. A document whose `nodes:` list is empty is
   * `true` — the user emptied the canvas, and the runtime refuses that
   * (`compiler.rs:459`).
   */
  readonly hasGraph: boolean;
}

/**
 * The live document's admission state.
 *
 * Prefers `FlowEditorContext` (a node panel must judge the document that
 * produced it) and falls back to the yaml store for callers mounted outside
 * the canvas — the save gate in the configuration panel is one. In the
 * editor the two are the same object; the store read is what makes the gate
 * work at all, since `<FlowEditorContext.Provider>` lives inside
 * `FlowWrapper`, a lazily-loaded sibling of the panel.
 */
export function useGraphAdmission(): GraphAdmission {
  const contextDocument = useContext(FlowEditorContext)?.yamlJsonObject;
  const storeDocument = usePipelineYamlStore((state) => state.yamlJsonObject);
  const document = (contextDocument ?? storeDocument) as YamlPipelineDocument;
  return { issues: admissionIssuesFor(document), hasGraph: holdsDocument(document) };
}

/** The admission issues one node's panel should show, in compiler order. */
export function useNodeAdmissionIssues(nodeId: string): readonly GraphAdmissionIssue[] {
  const { issues } = useGraphAdmission();
  return issuesForNode(issues, nodeId);
}
