import { describe, expect, it } from 'vitest';

import {
  PUBLIC_PROJECT_ID,
  canEditPipeline,
  getPipelineId,
  isPublicPipeline,
  pipelineDisplayName,
  pipelineViewMode,
} from './pipelineEditorViewState';

describe('getPipelineId', () => {
  it('prefers entity_meta.id', () => {
    expect(getPipelineId({ entity_meta: { id: 'a' }, id: 'b', meta: { id: 'c' } })).toBe('a');
  });

  it('falls back to id when entity_meta.id is absent', () => {
    expect(getPipelineId({ id: 'b', meta: { id: 'c' } })).toBe('b');
  });

  it('falls back to meta.id when neither entity_meta.id nor id are present', () => {
    expect(getPipelineId({ meta: { id: 'c' } })).toBe('c');
  });

  it('returns undefined for null/undefined pipeline', () => {
    expect(getPipelineId(null)).toBeUndefined();
    expect(getPipelineId(undefined)).toBeUndefined();
  });
});

describe('isPublicPipeline', () => {
  it('is true only when entity_meta.project_id is the public project id', () => {
    expect(isPublicPipeline({ entity_meta: { project_id: PUBLIC_PROJECT_ID } })).toBe(true);
    expect(isPublicPipeline({ entity_meta: { project_id: 'proj-1' } })).toBe(false);
    expect(isPublicPipeline(null)).toBe(false);
  });
});

describe('canEditPipeline', () => {
  it('requires non-public AND edit permission', () => {
    expect(canEditPipeline(false, true)).toBe(true);
    expect(canEditPipeline(true, true)).toBe(false);
    expect(canEditPipeline(false, false)).toBe(false);
  });
});

describe('pipelineViewMode', () => {
  it('maps canEditIt to Owner/Public', () => {
    expect(pipelineViewMode(true)).toBe('Owner');
    expect(pipelineViewMode(false)).toBe('Public');
  });
});

describe('pipelineDisplayName', () => {
  it('prefers meta.name, then name, then the fallback', () => {
    expect(pipelineDisplayName({ meta: { name: 'Meta name' }, name: 'Plain name' })).toBe('Meta name');
    expect(pipelineDisplayName({ name: 'Plain name' })).toBe('Plain name');
    expect(pipelineDisplayName({}, 'Unnamed Pipeline')).toBe('Unnamed Pipeline');
    expect(pipelineDisplayName(null, 'Unnamed Pipeline')).toBe('Unnamed Pipeline');
  });
});
