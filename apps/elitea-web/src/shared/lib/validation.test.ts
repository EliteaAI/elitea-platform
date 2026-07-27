import { describe, expect, it } from 'vitest';

import {
  ConversationNameRegExp,
  ConversationNameWarningMessage,
  FolderNameWarningMessage,
  NormalSingleTagNameInputRegExp,
  NormalTagNameInputRegExp,
  parseBooleanFlag,
} from './validation';

describe('NormalTagNameInputRegExp', () => {
  it.each([
    ['tag_one', true],
    ['tag one, two', true],
    ['tag!', false],
  ])('%j -> %j', (input, expected) => {
    NormalTagNameInputRegExp.lastIndex = 0;
    expect(NormalTagNameInputRegExp.test(input)).toBe(expected);
  });
});

describe('NormalSingleTagNameInputRegExp', () => {
  it.each([
    ['tagname', true],
    ['  tag  ', true],
    ['', true],
  ])('%j -> %j', (input, expected) => {
    NormalSingleTagNameInputRegExp.lastIndex = 0;
    expect(NormalSingleTagNameInputRegExp.test(input)).toBe(expected);
  });
});

describe('ConversationNameRegExp', () => {
  it.each([
    ['Valid Chat Name', true],
    ['ab', false],
    [' leading space name', false],
    ['ok[1].()-_ name', true],
  ])('%j -> %j', (input, expected) => {
    expect(ConversationNameRegExp.test(input)).toBe(expected);
  });

  it('has matching warning copy for chats and folders', () => {
    expect(ConversationNameWarningMessage).toMatch(/3 to 64 characters/);
    expect(FolderNameWarningMessage).toMatch(/3 to 64 characters/);
  });
});

describe('parseBooleanFlag', () => {
  it.each([
    [undefined, true, true],
    [null, false, false],
    ['1', false, true],
    [1, false, true],
    [true, false, true],
    ['0', true, false],
    [0, true, false],
    [false, true, false],
    ['yes', true, false],
  ])('parseBooleanFlag(%j, default=%j) -> %j', (value, defaultValue, expected) => {
    expect(parseBooleanFlag(value, defaultValue)).toBe(expected);
  });
});
