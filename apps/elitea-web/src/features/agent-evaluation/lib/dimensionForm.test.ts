import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DIMENSION_FORM,
  EVAL_ENGINE,
  EVAL_POLARITY,
  EVAL_RETURN_CONTRACT,
  EVAL_SCALE_TYPE,
  EVAL_TIER,
  type EvalDimension,
  type EvalDimensionForm,
} from '../model/types';
import { isCodeOnly, toFormState, toggleEngine, toWriteInput, validateDimensionForm } from './dimensionForm';

function validForm(overrides: Partial<EvalDimensionForm> = {}): EvalDimensionForm {
  return {
    ...DEFAULT_DIMENSION_FORM,
    name: 'Helpfulness',
    polarity: EVAL_POLARITY.higherBetter,
    allowed_engines: [EVAL_ENGINE.ai],
    ...overrides,
  };
}

describe('toggleEngine — the code-engine mutual exclusion', () => {
  /*
   * The rule the whole slice is built around: `['code']` is mutually exclusive
   * with ai/human. It is enforced in the TRANSITION rather than checked after
   * it, so the illegal state is unreachable from the UI instead of merely
   * rejected at save — an author never ticks a box they cannot then save.
   */
  it('replaces the whole set when Code is picked', () => {
    expect(toggleEngine([EVAL_ENGINE.ai], EVAL_ENGINE.code)).toEqual([EVAL_ENGINE.code]);
    expect(toggleEngine([EVAL_ENGINE.ai, EVAL_ENGINE.human], EVAL_ENGINE.code)).toEqual([EVAL_ENGINE.code]);
  });

  it('replaces Code when AI or Human is picked while Code is selected', () => {
    expect(toggleEngine([EVAL_ENGINE.code], EVAL_ENGINE.ai)).toEqual([EVAL_ENGINE.ai]);
    expect(toggleEngine([EVAL_ENGINE.code], EVAL_ENGINE.human)).toEqual([EVAL_ENGINE.human]);
  });

  it('never produces a set holding Code alongside AI or Human', () => {
    const reachable: string[][] = [];
    const engines = [EVAL_ENGINE.ai, EVAL_ENGINE.human, EVAL_ENGINE.code] as const;
    // Every two-step path from every starting set. The property is exhaustive
    // over what a person can actually do with three checkboxes.
    for (const start of engines) {
      for (const first of engines) {
        for (const second of engines) {
          reachable.push(toggleEngine(toggleEngine([start], first), second));
        }
      }
    }
    for (const set of reachable) {
      if (set.includes(EVAL_ENGINE.code)) {
        expect(set).toEqual([EVAL_ENGINE.code]);
      }
    }
  });

  it('toggles AI and Human independently of each other', () => {
    expect(toggleEngine([EVAL_ENGINE.ai], EVAL_ENGINE.human)).toEqual([EVAL_ENGINE.ai, EVAL_ENGINE.human]);
    expect(toggleEngine([EVAL_ENGINE.ai, EVAL_ENGINE.human], EVAL_ENGINE.ai)).toEqual([EVAL_ENGINE.human]);
  });

  it('unticking Code leaves an empty set, which validation then refuses', () => {
    expect(toggleEngine([EVAL_ENGINE.code], EVAL_ENGINE.code)).toEqual([]);
    expect(validateDimensionForm(validForm({ allowed_engines: [] }), undefined)?.key).toContain(
      'engineRequired',
    );
  });
});

describe('isCodeOnly', () => {
  it('is true only for exactly [code]', () => {
    expect(isCodeOnly([EVAL_ENGINE.code])).toBe(true);
    expect(isCodeOnly([EVAL_ENGINE.code, EVAL_ENGINE.ai])).toBe(false);
    expect(isCodeOnly([EVAL_ENGINE.ai])).toBe(false);
    expect(isCodeOnly([])).toBe(false);
  });
});

describe('validateDimensionForm', () => {
  it('accepts a complete form', () => {
    expect(validateDimensionForm(validForm(), undefined)).toBeUndefined();
  });

  it('requires a name', () => {
    expect(validateDimensionForm(validForm({ name: '   ' }), undefined)?.key).toContain('nameRequired');
  });

  it('caps the name at the column width', () => {
    expect(validateDimensionForm(validForm({ name: 'x'.repeat(129) }), undefined)?.key).toContain(
      'nameTooLong',
    );
    expect(validateDimensionForm(validForm({ name: 'x'.repeat(128) }), undefined)).toBeUndefined();
  });

  it('requires validation code for a code dimension', () => {
    const form = validForm({ allowed_engines: [EVAL_ENGINE.code], code: '  ' });
    expect(validateDimensionForm(form, undefined)?.key).toContain('codeRequired');
    expect(validateDimensionForm({ ...form, code: 'def score(x): return True' }, undefined)).toBeUndefined();
  });

  it('requires a polarity, and does not default one', () => {
    // Not a nicety: polarity is applied LAST in normalisation, so an inverse
    // metric saved without it scores a good answer 0 and nothing reports that.
    expect(DEFAULT_DIMENSION_FORM.polarity).toBe('');
    expect(validateDimensionForm(validForm({ polarity: '' }), undefined)?.key).toContain('polarityRequired');
  });

  it('requires strictly ordered scale bounds', () => {
    expect(validateDimensionForm(validForm({ scale_min: '5', scale_max: '5' }), undefined)?.key).toContain(
      'scaleNotOrdered',
    );
    expect(validateDimensionForm(validForm({ scale_min: '100', scale_max: '0' }), undefined)?.key).toContain(
      'scaleNotOrdered',
    );
    expect(validateDimensionForm(validForm({ scale_min: 'abc' }), undefined)?.key).toContain(
      'scaleNotNumeric',
    );
    expect(validateDimensionForm(validForm({ scale_min: '-1', scale_max: '1' }), undefined)).toBeUndefined();
  });

  it('requires a target and its operator together or not at all', () => {
    expect(validateDimensionForm(validForm({ default_target: '80' }), undefined)?.key).toContain(
      'targetPairIncomplete',
    );
    expect(validateDimensionForm(validForm({ default_target_operator: '>=' }), undefined)?.key).toContain(
      'targetPairIncomplete',
    );
    expect(
      validateDimensionForm(validForm({ default_target: '80', default_target_operator: '>=' }), undefined),
    ).toBeUndefined();
  });

  it('refuses the agent tier with no agent in context', () => {
    const form = validForm({ tier: EVAL_TIER.agentAdhoc });
    expect(validateDimensionForm(form, undefined)?.key).toContain('agentScopeUnavailable');
    expect(validateDimensionForm(form, 42)).toBeUndefined();
  });
});

describe('toWriteInput', () => {
  it('clears the script when the dimension is not code-engined', () => {
    // A stored script on an AI dimension reads as an executable a sandbox
    // would honour, and the author who unticked Code believes it is gone.
    const body = toWriteInput(
      validForm({ allowed_engines: [EVAL_ENGINE.ai], code: 'def score(x): return True' }),
      undefined,
    );
    expect(body.code).toBe('');
    expect(body.return_contract).toBe('');
  });

  it('keeps the script and the return contract for a code dimension', () => {
    const body = toWriteInput(
      validForm({
        allowed_engines: [EVAL_ENGINE.code],
        code: 'def score(x): return True',
        return_contract: EVAL_RETURN_CONTRACT.number,
      }),
      undefined,
    );
    expect(body.code).toBe('def score(x): return True');
    expect(body.return_contract).toBe(EVAL_RETURN_CONTRACT.number);
  });

  it('sends the agent id only for the agent tier', () => {
    expect(toWriteInput(validForm({ tier: EVAL_TIER.project }), 42).application_id).toBeNull();
    expect(toWriteInput(validForm({ tier: EVAL_TIER.agentAdhoc }), 42).application_id).toBe(42);
  });

  it('coerces the numeric fields exactly once, at save', () => {
    const body = toWriteInput(
      validForm({
        scale_min: '1',
        scale_max: '5',
        default_weight: '2.5',
        default_target: '4',
        default_target_operator: '>=',
      }),
      undefined,
    );
    expect(body.scale_min).toBe(1);
    expect(body.scale_max).toBe(5);
    expect(body.default_weight).toBe(2.5);
    expect(body.default_target).toBe(4);
  });

  it('sends a null target when none was authored', () => {
    expect(toWriteInput(validForm(), undefined).default_target).toBeNull();
  });
});

describe('toFormState', () => {
  const stored: EvalDimension = {
    id: '7',
    name: 'Toxicity',
    description: 'Lower is better',
    tier: EVAL_TIER.agentAdhoc,
    application_id: 3,
    allowed_engines: [EVAL_ENGINE.ai],
    scale_type: EVAL_SCALE_TYPE.ordinal,
    scale_min: 1,
    scale_max: 5,
    polarity: EVAL_POLARITY.lowerBetter,
    default_weight: 2,
    default_target: 2,
    default_target_operator: '<=',
    code: '',
    return_contract: '',
  };

  it('round-trips a stored row into an editable, savable form', () => {
    const form = toFormState(stored);
    expect(validateDimensionForm(form, 3)).toBeUndefined();
    expect(form.scale_min).toBe('1');
    expect(form.default_target).toBe('2');
    expect(form.polarity).toBe(EVAL_POLARITY.lowerBetter);
    expect(toWriteInput(form, 3).default_target).toBe(2);
  });

  it('renders an absent target as an empty field, not as zero', () => {
    // `0` is a legal target. Turning "no target" into `0` would invent a
    // threshold the author never set.
    const form = toFormState({ ...stored, default_target: null, default_target_operator: '' });
    expect(form.default_target).toBe('');
    expect(toWriteInput(form, 3).default_target).toBeNull();
  });

  it('returns the create defaults for no dimension', () => {
    expect(toFormState(undefined).name).toBe('');
    expect(toFormState(undefined).polarity).toBe('');
  });
});
