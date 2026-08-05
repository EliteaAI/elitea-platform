import { describe, expect, it } from 'vitest';

import { parseSkillMarkdown } from './skillImport';

describe('parseSkillMarkdown', () => {
  it('parses quoted metadata, tags, and the Markdown body', () => {
    expect(
      parseSkillMarkdown(`---
name: "Review code"
description: 'Find defects'
tags: [quality, "review"]
---
# Instructions
Be careful.`),
    ).toEqual({
      name: 'Review code',
      description: 'Find defects',
      tags: ['quality', 'review'],
      instructions: '# Instructions\nBe careful.',
    });
  });

  it('allows missing or non-array tags', () => {
    expect(parseSkillMarkdown('---\nname: A\ndescription: B\ntags: quality\n---\nRun').tags).toEqual([]);
  });

  it('rejects content without frontmatter', () => {
    expect(() => parseSkillMarkdown('# Skill')).toThrow('frontmatter');
  });

  it('rejects frontmatter without required metadata', () => {
    expect(() => parseSkillMarkdown('---\nname: A\n---\nBody')).toThrow('name and description');
  });
});
