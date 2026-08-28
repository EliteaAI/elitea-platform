import { describe, expect, it } from 'vitest';

import type { Project } from '@/entities/project';

import { orderedProjectOptions } from '../lib/projectOptions';

function project(id: number, name: string): Project {
  return { id, name, suspended: false };
}

describe('orderedProjectOptions', () => {
  it('pins the public project first, then sorts the rest alphabetically', () => {
    const projects = [project(3, 'Zulu'), project(11, 'Public'), project(2, 'Alpha'), project(5, 'mango')];
    const ordered = orderedProjectOptions(projects, '11');
    expect(ordered.map((p) => p.name)).toEqual(['Public', 'Alpha', 'mango', 'Zulu']);
  });

  it('uses user-facing names and pins the personal project after the public project', () => {
    const projects = [
      project(7, 'Zulu'),
      project(2, 'project_user_3'),
      project(1, 'promptlib_public'),
      project(4, 'Alpha'),
    ];
    const ordered = orderedProjectOptions(projects, '1', '2');
    expect(ordered.map((p) => [p.id, p.name])).toEqual([
      [1, 'Public'],
      [2, 'Private'],
      [4, 'Alpha'],
      [7, 'Zulu'],
    ]);
  });

  it('does not infer a personal project from its storage-name pattern', () => {
    const projects = [project(2, 'project_user_3'), project(1, 'promptlib_public')];
    const ordered = orderedProjectOptions(projects, '1');
    expect(ordered.map((p) => p.name)).toEqual(['Public', 'project_user_3']);
  });

  it('is a pure alphabetical sort when no project matches the public id', () => {
    const projects = [project(3, 'Zulu'), project(2, 'Alpha')];
    const ordered = orderedProjectOptions(projects, '999');
    expect(ordered.map((p) => p.name)).toEqual(['Alpha', 'Zulu']);
  });

  it('handles an empty project list', () => {
    expect(orderedProjectOptions([], '11')).toEqual([]);
  });

  it('compares the public project id as a string, matching a numeric-looking string id', () => {
    const projects = [project(11, 'Public'), project(1, 'A')];
    expect(orderedProjectOptions(projects, '11').map((p) => p.name)).toEqual(['Public', 'A']);
  });
});
