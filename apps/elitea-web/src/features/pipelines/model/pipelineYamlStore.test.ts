import { beforeEach, describe, expect, it } from 'vitest';

import { createPipelineYamlStore, usePipelineYamlStore } from './pipelineYamlStore';

const INITIAL_STATE = {
  yamlCode: '',
  yamlJsonObject: {},
  initYamlCode: '',
  initYamlJsonObject: {},
  resetFlag: false,
  layoutVersion: undefined,
};

beforeEach(() => {
  // Full reset for test isolation — the singleton persists across tests,
  // and `resetPipelineYaml()` itself now restores to the (test-polluted)
  // init snapshot rather than blanking it (see the store's own doc comment
  // on that behaviour correction), so it cannot be used for test cleanup.
  usePipelineYamlStore.setState(INITIAL_STATE);
});

describe('createPipelineYamlStore', () => {
  it('starts with empty yamlCode/yamlJsonObject/initYamlCode/initYamlJsonObject, resetFlag false, layoutVersion undefined', () => {
    const store = createPipelineYamlStore();
    expect(store.getState()).toMatchObject(INITIAL_STATE);
  });

  it('setYamlCode replaces the current code without touching initYamlCode', () => {
    const store = createPipelineYamlStore();
    store.getState().setYamlCode('nodes: []');
    expect(store.getState().yamlCode).toBe('nodes: []');
    expect(store.getState().initYamlCode).toBe('');
  });

  it('setYamlJsonObject replaces the object (shallow), matching the baseline reducer', () => {
    const store = createPipelineYamlStore();
    store.getState().setYamlJsonObject({ nodes: [{ id: 'a' }] });
    expect(store.getState().yamlJsonObject).toEqual({ nodes: [{ id: 'a' }] });
  });

  it('initPipelineYaml seeds both the current and the saved snapshot (yamlCode + yamlJsonObject)', () => {
    const store = createPipelineYamlStore();
    store.getState().initPipelineYaml({ yamlCode: 'state: {}', yamlJsonObject: { state: {} } });
    expect(store.getState().yamlCode).toBe('state: {}');
    expect(store.getState().yamlJsonObject).toEqual({ state: {} });
    expect(store.getState().initYamlCode).toBe('state: {}');
    expect(store.getState().initYamlJsonObject).toEqual({ state: {} });
  });

  it('markYamlCodeSaved copies the CURRENT yamlCode into initYamlCode without touching yamlJsonObject/initYamlJsonObject', () => {
    const store = createPipelineYamlStore();
    store.getState().initPipelineYaml({ yamlCode: 'a: 1', yamlJsonObject: { a: 1 } });
    store.getState().setYamlCode('a: 2');
    store.getState().markYamlCodeSaved();
    expect(store.getState().initYamlCode).toBe('a: 2');
    expect(store.getState().yamlJsonObject).toEqual({ a: 1 });
    expect(store.getState().initYamlJsonObject).toEqual({ a: 1 });
  });

  it('resetPipelineYaml restores yamlCode/yamlJsonObject from the last init snapshot (NOT to blank) and sets resetFlag', () => {
    const store = createPipelineYamlStore();
    store.getState().initPipelineYaml({ yamlCode: 'a: 1', yamlJsonObject: { a: 1 } });
    store.getState().setYamlCode('a: 2 (unsaved edit)');
    store.getState().setYamlJsonObject({ a: 2 });

    store.getState().resetPipelineYaml();

    expect(store.getState().yamlCode).toBe('a: 1');
    expect(store.getState().yamlJsonObject).toEqual({ a: 1 });
    expect(store.getState().resetFlag).toBe(true);
  });

  it('resetPipelineYaml on a never-initialised store restores to blank (the init snapshot itself is still blank)', () => {
    const store = createPipelineYamlStore();
    store.getState().setYamlCode('scratch');
    store.getState().resetPipelineYaml();
    expect(store.getState().yamlCode).toBe('');
    expect(store.getState().yamlJsonObject).toEqual({});
  });

  it('clearResetFlag flips resetFlag back to false', () => {
    const store = createPipelineYamlStore();
    store.getState().resetPipelineYaml();
    expect(store.getState().resetFlag).toBe(true);
    store.getState().clearResetFlag();
    expect(store.getState().resetFlag).toBe(false);
  });

  it('setLayoutVersion sets layoutVersion', () => {
    const store = createPipelineYamlStore();
    store.getState().setLayoutVersion('v2');
    expect(store.getState().layoutVersion).toBe('v2');
  });

  it('two independently-created stores do not share state', () => {
    const storeA = createPipelineYamlStore();
    const storeB = createPipelineYamlStore();
    storeA.getState().setYamlCode('only-on-a');
    expect(storeB.getState().yamlCode).toBe('');
  });
});

describe('usePipelineYamlStore (lazy singleton)', () => {
  it('getState/setState operate on the same underlying instance the hook selector reads', () => {
    usePipelineYamlStore.setState({ yamlCode: 'hello: world' });
    expect(usePipelineYamlStore.getState().yamlCode).toBe('hello: world');
  });
});
