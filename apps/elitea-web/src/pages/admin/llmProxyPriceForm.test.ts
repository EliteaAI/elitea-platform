/**
 * The price form's number handling.
 *
 * This is where a costing bug would live, and every property below is one that
 * a rendering test could not see:
 *
 *  1. **Blank and zero are different.** Blank means the model has no rate for
 *     that dimension; `0` means the dimension is free. Collapsing them either
 *     invents a price or erases a real one, and the stored row looks plausible
 *     both ways.
 *  2. **Every field is present in the request, including the null ones.**
 *     Omitting a blank field would leave whatever was stored, so a rate that
 *     should not exist could never be cleared.
 *  3. **A round trip does not mutate a price.** The form is seeded from a stored
 *     row and read back on save; a formatting slip there would silently re-price
 *     a model that the operator only opened to look at.
 */
import { describe, expect, it } from 'vitest';

import {
  PRICE_FIELD_KEYS,
  draftHasAnyPrice,
  emptyPriceDraft,
  priceDraftFromRow,
  priceDraftToWrite,
} from './llmProxyPriceForm';
import type { LlmModelRow, UnpricedLlmModel } from './api/adminLlmProxyApi';

const STORED_ROW: LlmModelRow = {
  id: 'row-1',
  provider: 'openai',
  model_name: 'gpt-5',
  input_cost_per_1m_tokens: 1.25,
  output_cost_per_1m_tokens: 10,
  // Free, not absent. This is the value the blank/zero distinction turns on.
  input_cost_per_1m_seconds: 0,
  output_cost_per_1m_seconds: null,
  input_cost_per_1m_characters: null,
  output_cost_per_1m_characters: null,
  source: 'litellm',
  price_overridden: false,
  requests: 12,
  total_tokens: 3400,
  cost_usd: 0.42,
};

const UNPRICED: UnpricedLlmModel = {
  provider: 'anthropic',
  model_name: 'claude-opus-5',
  requests: 9,
  total_tokens: 100,
  cost_usd: 0,
};

describe('llmProxyPriceForm', () => {
  it('keeps a zero price distinct from an absent one when seeding the form', () => {
    const draft = priceDraftFromRow(STORED_ROW, undefined);

    // 0 renders as "0", not as blank: this model's audio input is FREE, and a
    // blank box would say it has no per-second rate at all — which is a
    // materially different state, since an audio call with no rate is billed
    // nothing and no budget can stop it.
    expect(draft.input_cost_per_1m_seconds).toBe('0');
    expect(draft.output_cost_per_1m_seconds).toBe('');
    expect(draft.input_cost_per_1m_tokens).toBe('1.25');
  });

  it('round-trips a stored row without changing any price', () => {
    const written = priceDraftToWrite(priceDraftFromRow(STORED_ROW, undefined));

    expect(written.input_cost_per_1m_tokens).toBe(1.25);
    expect(written.output_cost_per_1m_tokens).toBe(10);
    expect(written.input_cost_per_1m_seconds).toBe(0);
    expect(written.output_cost_per_1m_seconds).toBeNull();
    expect(written.provider).toBe('openai');
    expect(written.model_name).toBe('gpt-5');
  });

  it('sends every price field, so a rate can be cleared', () => {
    const written = priceDraftToWrite(emptyPriceDraft) as unknown as Record<string, unknown>;

    for (const key of PRICE_FIELD_KEYS) {
      // Present AND null. Absent would mean "leave it as it was", which makes
      // removing a wrong rate impossible.
      expect(Object.hasOwn(written, key)).toBe(true);
      expect(written[key]).toBeNull();
    }
  });

  it('treats a blank or whitespace field as no rate rather than zero', () => {
    const written = priceDraftToWrite({
      ...emptyPriceDraft,
      provider: 'openai',
      model_name: 'gpt-5',
      input_cost_per_1m_tokens: '   ',
      output_cost_per_1m_tokens: '0',
    });

    expect(written.input_cost_per_1m_tokens).toBeNull();
    // Zero survives as zero — the model's output is free, which is a real state.
    expect(written.output_cost_per_1m_tokens).toBe(0);
  });

  it('never emits NaN for an unparseable price', () => {
    const written = priceDraftToWrite({
      ...emptyPriceDraft,
      provider: 'openai',
      model_name: 'gpt-5',
      input_cost_per_1m_tokens: 'not a number',
    });

    expect(written.input_cost_per_1m_tokens).toBeNull();
    expect(Number.isNaN(written.input_cost_per_1m_tokens as number)).toBe(false);
  });

  it('seeds identity only from an unpriced pair, inventing no price', () => {
    const draft = priceDraftFromRow(undefined, UNPRICED);

    expect(draft.provider).toBe('anthropic');
    expect(draft.model_name).toBe('claude-opus-5');
    for (const key of PRICE_FIELD_KEYS) {
      expect(draft[key]).toBe('');
    }
  });

  it('trims the identity, so a stray space cannot create a second row', () => {
    const written = priceDraftToWrite({
      ...emptyPriceDraft,
      provider: '  openai ',
      model_name: ' gpt-5  ',
      input_cost_per_1m_tokens: '1',
    });

    // (provider, model_name) is the unique key. An untrimmed value would insert
    // a SECOND row and leave the original priced as it was.
    expect(written.provider).toBe('openai');
    expect(written.model_name).toBe('gpt-5');
  });

  it('reports a draft that prices nothing, which the server refuses', () => {
    expect(draftHasAnyPrice(emptyPriceDraft)).toBe(false);
    // Such a save would mark the row overridden — excluding it from the price
    // sync forever — while pricing nothing, so the model keeps billing at the
    // gateway's invented fallback rate for good.
    expect(draftHasAnyPrice({ ...emptyPriceDraft, output_cost_per_1m_tokens: '0' })).toBe(true);
  });
});
