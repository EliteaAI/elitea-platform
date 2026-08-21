/**
 * DEFECT: two `/* eslint-disable-next-line i18next/no-literal-string *​/` comments
 * sat in JSX children position (between `)}` and the next `<IconButtonAny>`),
 * not inside a `{…}` expression container. JSX treats such text as a child
 * node, so React rendered the raw comment source as visible text in the
 * attachment card's hover action row, twice, beside the download and remove
 * icons.
 *
 * EVIDENCE: a jsdom render produced the textContent
 * `report.pdf👁/* eslint-disable… *​/↓/* eslint-disable… *​/✕`.
 * Neither oxlint nor typecheck reports this class of defect, so the card's
 * text content is pinned here.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Attachment } from '@/entities/attachment/model/types';

import { NormalAttachment } from './NormalAttachment';

const ATTACHMENT = { name: 'report.pdf' } as unknown as Attachment;

describe('NormalAttachment', () => {
  it('renders only the file name and the icon glyphs, with no source comments', () => {
    render(<NormalAttachment attachment={ATTACHMENT} preview />);

    const card = screen.getByTestId('chat-artifact-file-card');
    expect(card.textContent).not.toContain('eslint-disable');
    expect(card.textContent).toBe('report.pdf👁↓✕');
  });
});
