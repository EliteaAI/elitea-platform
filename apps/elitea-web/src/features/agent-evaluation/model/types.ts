/**
 * The evaluation DIMENSION vocabulary, ported from the baseline's
 * `apps/elitea-ui/src/[fsd]/widgets/evaluation/lib/constants/
 * evaluation.constants.js`.
 *
 * SCOPE. Only the dimension half is here. The baseline's constants file also
 * carries suite, binding, dataset, case, run, result and human-score
 * vocabularies; none of those has a backend in this release, and a constant
 * with no reader is what the dead-code gate exists to catch.
 */

export const EVAL_ENGINE = {
  ai: 'ai',
  human: 'human',
  code: 'code',
} as const;
export type EvalEngine = (typeof EVAL_ENGINE)[keyof typeof EVAL_ENGINE];

export const EVAL_TIER = {
  project: 'project',
  agentAdhoc: 'agent_adhoc',
  platform: 'platform',
} as const;
type EvalTier = (typeof EVAL_TIER)[keyof typeof EVAL_TIER];

export const EVAL_SCALE_TYPE = {
  binary: 'binary',
  ordinal: 'ordinal',
  continuous: 'continuous',
} as const;
type EvalScaleType = (typeof EVAL_SCALE_TYPE)[keyof typeof EVAL_SCALE_TYPE];

export const EVAL_POLARITY = {
  higherBetter: 'higher_better',
  lowerBetter: 'lower_better',
} as const;
export type EvalPolarity = (typeof EVAL_POLARITY)[keyof typeof EVAL_POLARITY];

export const EVAL_RETURN_CONTRACT = {
  bool: 'bool',
  number: 'number',
} as const;
type EvalReturnContract = (typeof EVAL_RETURN_CONTRACT)[keyof typeof EVAL_RETURN_CONTRACT];

/**
 * The comparison operators a target is evaluated with. `==` rather than `=`,
 * because that is the exact string the (not-yet-built) scorer switches on —
 * the baseline's `evaluateTargetMet` in `scorecard.helpers.js`.
 */
export const EVAL_TARGET_OPERATORS = ['>=', '>', '<=', '<', '=='] as const;
export type EvalTargetOperator = (typeof EVAL_TARGET_OPERATORS)[number];

/** One stored library row, as the API returns it. */
export interface EvalDimension {
  readonly id: string;
  readonly uuid?: string;
  readonly name: string;
  readonly description: string;
  readonly tier: EvalTier;
  readonly application_id: number | null;
  readonly allowed_engines: readonly EvalEngine[];
  readonly scale_type: EvalScaleType;
  readonly scale_min: number;
  readonly scale_max: number;
  readonly polarity: EvalPolarity | '';
  readonly default_weight: number;
  readonly default_target: number | null;
  readonly default_target_operator: EvalTargetOperator | '';
  readonly code: string;
  readonly return_contract: EvalReturnContract | '';
  readonly created_at?: string;
  readonly updated_at?: string;
}

/**
 * The editor's working state.
 *
 * Numeric fields are STRINGS here on purpose: a number input whose value is a
 * number cannot hold the intermediate states a person types — `""` while
 * clearing it, `"-"` before the digits, `"1."` mid-decimal. Coercing on every
 * keystroke makes the field fight the typist. The conversion happens once, at
 * save.
 */
export interface EvalDimensionForm {
  name: string;
  description: string;
  tier: EvalTier;
  allowed_engines: EvalEngine[];
  scale_type: EvalScaleType;
  scale_min: string;
  scale_max: string;
  /**
   * Deliberately allowed to be `''`, and deliberately NOT defaulted.
   *
   * Polarity is applied LAST in score normalisation, so an inverse metric
   * (toxicity, latency, cost) authored without it silently scores a GOOD answer
   * 0 and nothing anywhere reports that. The baseline leaves it unset for the
   * same reason and refuses to save until the author states it.
   */
  polarity: EvalPolarity | '';
  default_weight: string;
  default_target: string;
  default_target_operator: EvalTargetOperator | '';
  code: string;
  return_contract: EvalReturnContract;
}

/** The body the create/update routes accept. */
export interface EvalDimensionWriteInput {
  readonly name: string;
  readonly description: string;
  readonly tier: EvalTier;
  readonly application_id: number | null;
  readonly allowed_engines: readonly EvalEngine[];
  readonly scale_type: EvalScaleType;
  readonly scale_min: number;
  readonly scale_max: number;
  readonly polarity: EvalPolarity;
  readonly default_weight: number;
  readonly default_target: number | null;
  readonly default_target_operator: EvalTargetOperator | '';
  readonly code: string;
  readonly return_contract: EvalReturnContract | '';
}

export const DEFAULT_DIMENSION_FORM: EvalDimensionForm = {
  name: '',
  description: '',
  tier: EVAL_TIER.project,
  allowed_engines: [EVAL_ENGINE.ai],
  scale_type: EVAL_SCALE_TYPE.continuous,
  scale_min: '0',
  scale_max: '100',
  polarity: '',
  default_weight: '1',
  default_target: '',
  default_target_operator: '',
  code: '',
  return_contract: EVAL_RETURN_CONTRACT.bool,
};
