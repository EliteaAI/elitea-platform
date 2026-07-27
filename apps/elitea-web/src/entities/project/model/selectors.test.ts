import { describe, expect, it } from 'vitest';

import { isPublicProject, isSuspendedProject, sortProjectsByName } from './selectors';
import type { Project } from './types';

const project = (id: number, name: string, status: Project['status'] = 'active'): Project => ({
  id,
  name,
  status,
  suspended: status === 'suspended',
});

describe('isPublicProject', () => {
  it('is true when the ids match as strings', () => {
    expect(isPublicProject(0, 0)).toBe(true);
    expect(isPublicProject('0', 0)).toBe(true);
  });

  it('is false when the ids differ', () => {
    expect(isPublicProject(5, 0)).toBe(false);
  });
});

describe('isSuspendedProject', () => {
  it('is true when status is suspended', () => {
    expect(isSuspendedProject(project(1, 'p', 'suspended'))).toBe(true);
  });

  it('is true when the suspended flag is set even if status lags', () => {
    expect(isSuspendedProject({ ...project(1, 'p'), suspended: true })).toBe(true);
  });

  it('is false for an active, non-suspended project', () => {
    expect(isSuspendedProject(project(1, 'p', 'active'))).toBe(false);
  });
});

describe('sortProjectsByName', () => {
  it('sorts case-insensitively', () => {
    const projects = [project(1, 'zeta'), project(2, 'Alpha')];
    expect(sortProjectsByName(projects).map((p) => p.id)).toEqual([2, 1]);
  });

  it('does not mutate the input', () => {
    const projects = [project(1, 'b'), project(2, 'a')];
    const copy = [...projects];
    sortProjectsByName(projects);
    expect(projects).toEqual(copy);
  });
});
