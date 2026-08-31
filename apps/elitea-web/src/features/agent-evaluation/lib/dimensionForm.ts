/**
 * The dimension editor's pure logic: the engine toggle, the validation, and
 * the form → wire-body conversion.
 *
 * It is a separate module from the dialog because every rule in it is also
 * enforced by the server (`internal/api/v2/evaluation/dimension.go`) and by
 * the table (`migrations/tenant/0130_eval_dimensions.sql`), and three copies of
 * one rule only stay in agreement if the copy here is directly testable. A rule
 * buried in a component body is exercised only through a render.
 */
import {
  DEFAULT_DIMENSION_FORM,
  EVAL_ENGINE,
  EVAL_RETURN_CONTRACT,
  EVAL_TARGET_OPERATORS,
  EVAL_TIER,
  type EvalDimension,
  type EvalDimensionForm,
  type EvalDimensionWriteInput,
  type EvalEngine,
  type EvalPolarity,
  type EvalTargetOperator,
} from '../model/types';

/** The name length the column and the server both cap at. */
export const MAX_DIMENSION_NAME_LENGTH = 128;

/** `allowed_engines === ['code']` — the shape the exclusivity rule is written in terms of. */
export function isCodeOnly(engines: readonly EvalEngine[]): boolean {
  return engines.length === 1 && engines[0] === EVAL_ENGINE.code;
}

/**
 * Toggling one engine, with the mutual exclusion built into the transition
 * rather than checked after it.
 *
 * Picking Code REPLACES the set; picking AI or Human while Code is selected
 * replaces it too. This is the baseline's own behaviour
 * (`DimensionEditorDialog.jsx:92-104`) and it is what makes the illegal state
 * unreachable from the UI instead of merely rejected at save — an author never
 * sees a checkbox they can tick and then cannot save.
 *
 * The server still validates it: this function is one writer, and the route is
 * open to any principal holding the create permission.
 */
export function toggleEngine(engines: readonly EvalEngine[], engine: EvalEngine): EvalEngine[] {
  if (engine === EVAL_ENGINE.code) {
    return isCodeOnly(engines) ? [] : [EVAL_ENGINE.code];
  }
  const base = isCodeOnly(engines) ? [] : engines;
  return base.includes(engine) ? base.filter((entry) => entry !== engine) : [...base, engine];
}

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

function parsedNumber(value: string): number | undefined {
  if (isBlank(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * The reason a form cannot be saved, or `undefined`.
 *
 * Returns a stable KEY plus its English text so the dialog can render it
 * through `t()` without this module importing the i18n layer — keeping it a
 * pure function that a unit test can call directly.
 */
export interface DimensionFormError {
  readonly key: string;
  readonly text: string;
}

const ERRORS = {
  nameRequired: {
    key: 'features.agentEvaluation.errors.nameRequired',
    text: 'Name is required.',
  },
  nameTooLong: {
    key: 'features.agentEvaluation.errors.nameTooLong',
    text: 'Name must be at most 128 characters.',
  },
  engineRequired: {
    key: 'features.agentEvaluation.errors.engineRequired',
    text: 'Select at least one engine.',
  },
  codeRequired: {
    key: 'features.agentEvaluation.errors.codeRequired',
    text: 'Validation code is required for a code dimension.',
  },
  polarityRequired: {
    key: 'features.agentEvaluation.errors.polarityRequired',
    text: 'Pick a polarity — an inverse metric must be "Lower is better".',
  },
  scaleNotNumeric: {
    key: 'features.agentEvaluation.errors.scaleNotNumeric',
    text: 'Scale bounds must be numbers.',
  },
  scaleNotOrdered: {
    key: 'features.agentEvaluation.errors.scaleNotOrdered',
    text: 'Scale min must be strictly less than scale max.',
  },
  weightNotNumeric: {
    key: 'features.agentEvaluation.errors.weightNotNumeric',
    text: 'Default weight must be a number.',
  },
  targetPairIncomplete: {
    key: 'features.agentEvaluation.errors.targetPairIncomplete',
    text: 'Provide both a default target and an operator, or neither.',
  },
  targetNotNumeric: {
    key: 'features.agentEvaluation.errors.targetNotNumeric',
    text: 'Default target must be a number.',
  },
  agentScopeUnavailable: {
    key: 'features.agentEvaluation.errors.agentScopeUnavailable',
    text: '"This agent only" is unavailable without an agent.',
  },
} as const satisfies Record<string, DimensionFormError>;

function scaleError(form: EvalDimensionForm): DimensionFormError | undefined {
  const min = parsedNumber(form.scale_min);
  const max = parsedNumber(form.scale_max);
  if (min === undefined || max === undefined) return ERRORS.scaleNotNumeric;
  if (min >= max) return ERRORS.scaleNotOrdered;
  return undefined;
}

function targetError(form: EvalDimensionForm): DimensionFormError | undefined {
  const hasTarget = !isBlank(form.default_target);
  const hasOperator = form.default_target_operator !== '';
  if (hasTarget !== hasOperator) return ERRORS.targetPairIncomplete;
  if (hasTarget && parsedNumber(form.default_target) === undefined) return ERRORS.targetNotNumeric;
  return undefined;
}

/**
 * The single validation entry point. Order matters only for which message an
 * author sees first; every rule below is independently enforced server-side.
 */
export function validateDimensionForm(
  form: EvalDimensionForm,
  applicationId: number | undefined,
): DimensionFormError | undefined {
  if (isBlank(form.name)) return ERRORS.nameRequired;
  if (form.name.trim().length > MAX_DIMENSION_NAME_LENGTH) return ERRORS.nameTooLong;
  if (form.allowed_engines.length === 0) return ERRORS.engineRequired;
  if (isCodeOnly(form.allowed_engines) && isBlank(form.code)) return ERRORS.codeRequired;
  if (form.polarity === '') return ERRORS.polarityRequired;
  if (form.tier === EVAL_TIER.agentAdhoc && applicationId === undefined) {
    return ERRORS.agentScopeUnavailable;
  }
  if (parsedNumber(form.default_weight) === undefined) return ERRORS.weightNotNumeric;
  return scaleError(form) ?? targetError(form);
}

/**
 * Form → wire body.
 *
 * Only ever called on a form `validateDimensionForm` has accepted, which is
 * why the numeric coercions below can assert. `code` and `return_contract` are
 * CLEARED for a non-code dimension rather than carried: a stored script on an
 * AI dimension reads as an executable a sandbox would honour, and the author
 * who unticked Code believes it is gone.
 */
export function toWriteInput(
  form: EvalDimensionForm,
  applicationId: number | undefined,
): EvalDimensionWriteInput {
  const isCode = isCodeOnly(form.allowed_engines);
  const hasTarget = !isBlank(form.default_target);
  const isAdhoc = form.tier === EVAL_TIER.agentAdhoc;
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    tier: form.tier,
    application_id: isAdhoc && applicationId !== undefined ? applicationId : null,
    allowed_engines: form.allowed_engines,
    scale_type: form.scale_type,
    scale_min: Number(form.scale_min),
    scale_max: Number(form.scale_max),
    // Safe: `validateDimensionForm` refuses an empty polarity.
    polarity: form.polarity as EvalPolarity,
    default_weight: Number(form.default_weight),
    default_target: hasTarget ? Number(form.default_target) : null,
    default_target_operator: hasTarget ? form.default_target_operator : '',
    code: isCode ? form.code : '',
    return_contract: isCode ? form.return_contract : '',
  };
}

/** Stored row → editor state. A missing field falls back to the create default. */
export function toFormState(dimension: EvalDimension | undefined): EvalDimensionForm {
  if (!dimension)
    return {
      ...DEFAULT_DIMENSION_FORM,
      allowed_engines: [...DEFAULT_DIMENSION_FORM.allowed_engines],
    };
  const operator = EVAL_TARGET_OPERATORS.includes(dimension.default_target_operator as EvalTargetOperator)
    ? (dimension.default_target_operator as EvalTargetOperator)
    : '';
  return {
    name: dimension.name,
    description: dimension.description,
    tier: dimension.tier,
    allowed_engines:
      dimension.allowed_engines.length > 0
        ? [...dimension.allowed_engines]
        : [...DEFAULT_DIMENSION_FORM.allowed_engines],
    scale_type: dimension.scale_type,
    scale_min: String(dimension.scale_min),
    scale_max: String(dimension.scale_max),
    polarity: dimension.polarity,
    default_weight: String(dimension.default_weight),
    default_target: dimension.default_target === null ? '' : String(dimension.default_target),
    default_target_operator: operator,
    code: dimension.code,
    return_contract: dimension.return_contract === '' ? EVAL_RETURN_CONTRACT.bool : dimension.return_contract,
  };
}
