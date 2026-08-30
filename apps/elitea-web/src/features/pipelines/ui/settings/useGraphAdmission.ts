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
 * **Why the empty-graph guard is load-bearing.** An absent or node-less
 * document is not an invalid pipeline — it is an editor that has not been
 * seeded yet (`usePipelineVersionSync` runs after the first paint, and the
 * chat-side editor may never mount one). Reporting "a pipeline must hold
 * between 1 and 128 nodes" there would block the Save button on a screen
 * the user has not touched. `usePipelineGraphDraft` draws the same line for
 * the same reason (`yamlCode.trim() === ''` -> "nothing to save").
 */
import { useContext } from 'react';

import { FlowEditorContext } from '../../lib/flow-editor/flowEditorContext';
import type { YamlPipelineDocument } from '../../lib/flow-editor/helpers/pipelineFlow.types';
import { collectGraphAdmissionIssues, issuesForNode } from '../../lib/graphAdmission.helpers';
import type { GraphAdmissionIssue } from '../../lib/graphAdmission.types';
import { usePipelineYamlStore } from '../../model/pipelineYamlStore';

const NO_ISSUES: readonly GraphAdmissionIssue[] = [];

const ISSUE_CACHE = new WeakMap<object, readonly GraphAdmissionIssue[]>();

/** Admission issues for `document`, computed once per document object. */
function admissionIssuesFor(document: YamlPipelineDocument | undefined): readonly GraphAdmissionIssue[] {
  if (document === undefined || (document.nodes ?? []).length === 0) return NO_ISSUES;
  const cached = ISSUE_CACHE.get(document);
  if (cached !== undefined) return cached;
  const issues = collectGraphAdmissionIssues(document);
  ISSUE_CACHE.set(document, issues);
  return issues;
}

export interface GraphAdmission {
  /** Every reason the native runtime would refuse this graph. Empty for an admissible — or not-yet-seeded — document. */
  readonly issues: readonly GraphAdmissionIssue[];
  /** `false` while the editor holds no graph at all; nothing should be gated on admission then. */
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
  return { issues: admissionIssuesFor(document), hasGraph: (document.nodes ?? []).length > 0 };
}

/** The admission issues one node's panel should show, in compiler order. */
export function useNodeAdmissionIssues(nodeId: string): readonly GraphAdmissionIssue[] {
  const { issues } = useGraphAdmission();
  return issuesForNode(issues, nodeId);
}
