/**
 * The `answer` HITL control — the clarifying questions an `ask_user` pause
 * asks, and the one submit that resumes the run with them.
 *
 * There is no baseline for this card: `ask_user` is a capability of the NATIVE
 * runtime (`services/elitea-worker-rust/src/agents/internal_tools.rs`), and
 * the paused row it stores carries `guardrail_type: 'clarifying_question'`
 * with `available_actions: ['answer']` — an action the old approve/reject card
 * matched against no branch, so the pause rendered its question text with ZERO
 * controls under it and the run could never be resumed.
 *
 * Its own file for the §3.5 400-line budget: `ChatHitlActions.tsx` already
 * carries two card branches.
 *
 * WHAT THE SUBMITTED VALUE IS. One JSON object, `{ [question.id]: answer }`,
 * serialised to a string because every layer between here and the continuation
 * body types `value` as one. `AskUserRequest::format_answer` parses it back
 * and refuses an id it never asked about, so the keys are the ids off the
 * questions themselves and never anything derived on screen. A multi-select
 * question answers with an ARRAY; every other question answers with a string.
 */
import type { ReactNode } from 'react';
import { useState } from 'react';

import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';

import { t } from '@/shared/i18n';

import type { HitlQuestion } from '../../lib/hitlInterrupts';

/** One question's answer: a list for multi-select, one entry otherwise. */
type SelectionMap = Readonly<Record<string, readonly string[]>>;
type TextMap = Readonly<Record<string, string>>;

/**
 * What a pause that carries NO questions is answered with.
 *
 * A pause can reach the browser with its `questions` dropped (an older stored
 * row, a path that never carried them). The user still owes the run an answer,
 * so one free-text row is offered and the submitted value is then a bare JSON
 * STRING rather than a per-question object — the shape
 * `AskUserRequest::format_answer` reads as "User answered: <text>" and the
 * continuation route admits alongside the object one.
 */
const FALLBACK_QUESTIONS: readonly HitlQuestion[] = [{ id: 'q1', allow_other: true, options: [] }];

/** @public Props for `AnswerQuestionsControl`. */
export interface AnswerQuestionsControlProps {
  /** The pause's clarifying questions, in the order the model asked them. */
  readonly questions: readonly HitlQuestion[];
  /** Whether the controls are disabled (a resume already in flight). */
  readonly disabled?: boolean;
  /** Called with the JSON-encoded `{id: answer}` object. */
  readonly onSubmit: (value: string) => void;
}

/**
 * The id one question's answer is keyed by.
 *
 * `q{n}` mirrors the runtime's own default (`AskUserQuestion::normalize`), so
 * a question that reached the browser without an id is still answerable rather
 * than silently dropped from the submitted object.
 */
function questionId(question: HitlQuestion, index: number): string {
  return question.id && question.id.trim() ? question.id : `q${index + 1}`;
}

/** serde renames `multi_select` to `multiSelect`; the raw tool arguments use either. */
function isMultiSelect(question: HitlQuestion): boolean {
  return question.multiSelect === true || question.multi_select === true;
}

/** The label text of one option, or `''` for an option that carries none. */
function optionLabel(option: { readonly label?: string } | undefined): string {
  return typeof option?.label === 'string' ? option.label : '';
}

/**
 * The answer object, built from what is on screen.
 *
 * A question with nothing chosen and nothing typed is OMITTED rather than sent
 * as an empty string: the runtime renders every answered question into the
 * substituted tool result, and an empty one would read to the model as an
 * answer the user did not give.
 */
function buildAnswerValue(
  questions: readonly HitlQuestion[],
  selected: SelectionMap,
  typed: TextMap,
): Record<string, string | readonly string[]> {
  const answers: Record<string, string | readonly string[]> = {};
  questions.forEach((question, index) => {
    const id = questionId(question, index);
    const picked = selected[id] ?? [];
    const text = (typed[id] ?? '').trim();
    if (isMultiSelect(question)) {
      const values = text ? [...picked, text] : [...picked];
      if (values.length > 0) answers[id] = values;
      return;
    }
    const value = text || picked[0] || '';
    if (value) answers[id] = value;
  });
  return answers;
}

interface QuestionRowProps {
  readonly question: HitlQuestion;
  readonly index: number;
  readonly disabled: boolean;
  readonly picked: readonly string[];
  readonly text: string;
  readonly onPick: (label: string) => void;
  readonly onText: (value: string) => void;
}

/** One question: its header, its text, its option buttons and its free-text field. */
function QuestionRow({ question, index, disabled, picked, text, onPick, onText }: QuestionRowProps): ReactNode {
  const options = question.options ?? [];
  // A question with no options cannot be answered any other way, so the field
  // is offered whether or not the model set `allow_other`.
  const showText = question.allow_other === true || options.length === 0;

  return (
    <Box
      data-testid={`hitl-answer-question-${index}`}
      sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}
    >
      {question.header && (
        <Typography
          variant="caption"
          sx={{ fontWeight: 600, color: 'text.secondary' }}
        >
          {question.header}
        </Typography>
      )}
      {question.question && (
        <Typography
          variant="body2"
          sx={{ color: 'text.primary' }}
        >
          {question.question}
        </Typography>
      )}
      {options.length > 0 && (
        <Stack
          direction="row"
          spacing={1}
          sx={{ flexWrap: 'wrap', gap: 1 }}
        >
          {options.map((option, optionIndex) => {
            const label = optionLabel(option);
            const isPicked = picked.includes(label);
            return (
              <Button
                key={`${label}-${optionIndex}`}
                data-testid={`hitl-answer-option-${index}-${optionIndex}`}
                size="small"
                variant={isPicked ? 'contained' : 'outlined'}
                color="primary"
                onClick={() => onPick(label)}
                disabled={disabled || !label}
                {...(option.description ? { title: option.description } : {})}
              >
                {label}
              </Button>
            );
          })}
        </Stack>
      )}
      {showText && (
        <TextField
          fullWidth
          size="small"
          value={text}
          onChange={(event) => onText(event.target.value)}
          disabled={disabled}
          placeholder={t('chatMessages.hitlAnswer.otherPlaceholder', 'Type another answer…')}
          slotProps={{ htmlInput: { 'data-testid': `hitl-answer-other-${index}` } }}
        />
      )}
    </Box>
  );
}

/**
 * `AnswerQuestionsControl` — the questions, the answers, and the submit that
 * carries them back to the paused run.
 */
function AnswerQuestionsControl({
  questions,
  disabled = false,
  onSubmit,
}: AnswerQuestionsControlProps): ReactNode {
  const [selected, setSelected] = useState<SelectionMap>({});
  const [typed, setTyped] = useState<TextMap>({});

  const pick = (question: HitlQuestion, index: number, label: string): void => {
    const id = questionId(question, index);
    setSelected((previous) => {
      const current = previous[id] ?? [];
      if (!isMultiSelect(question)) {
        // Single-select: a second click on the SAME option clears it, so a
        // mis-click is recoverable without reloading the paused message.
        return { ...previous, [id]: current[0] === label ? [] : [label] };
      }
      return {
        ...previous,
        [id]: current.includes(label) ? current.filter((entry) => entry !== label) : [...current, label],
      };
    });
  };

  const freeTextOnly = questions.length === 0;
  const rows = freeTextOnly ? FALLBACK_QUESTIONS : questions;
  const answers = buildAnswerValue(rows, selected, typed);
  // The bare string for the no-questions fallback, the keyed object otherwise.
  const submitted: string | Record<string, string | readonly string[]> = freeTextOnly
    ? ((answers['q1'] as string | undefined) ?? '')
    : answers;
  const canSubmit = freeTextOnly ? submitted !== '' : Object.keys(answers).length > 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25, mt: 1, width: '100%' }}>
      {rows.map((question, index) => (
        <QuestionRow
          key={questionId(question, index)}
          question={question}
          index={index}
          disabled={disabled}
          picked={selected[questionId(question, index)] ?? []}
          text={typed[questionId(question, index)] ?? ''}
          onPick={(label) => pick(question, index, label)}
          onText={(value) => setTyped((previous) => ({ ...previous, [questionId(question, index)]: value }))}
        />
      ))}
      <Box>
        <Button
          data-testid="hitl-answer-submit"
          size="small"
          variant="contained"
          color="primary"
          onClick={() => onSubmit(JSON.stringify(submitted))}
          disabled={disabled || !canSubmit}
        >
          {t('chatMessages.hitlAnswer.submit', 'Send answer')}
        </Button>
      </Box>
    </Box>
  );
}

/** @public Props for `ClarifyingQuestionCard`. */
export interface ClarifyingQuestionCardProps {
  /** The pause's questions, in the order the model asked them. */
  readonly questions: readonly HitlQuestion[];
  /** The pause's own message — rendered only when it is not already a question. */
  readonly message?: string | undefined;
  /** Whether the controls are disabled (a resume already in flight). */
  readonly disabled?: boolean;
  /** Called with the JSON-encoded answer value. */
  readonly onSubmit: (value: string) => void;
}

/**
 * The clarification card: the same warning shell every other HITL pause
 * renders in, with the questions and their submit inside it.
 *
 * `message` is rendered only when there are NO questions. The runtime sets the
 * pause message to the FIRST question's text
 * (`AskUserRequest::message`), so printing both shows the same sentence twice.
 */
export function ClarifyingQuestionCard({
  questions,
  message,
  disabled = false,
  onSubmit,
}: ClarifyingQuestionCardProps): ReactNode {
  return (
    <Box
      data-testid="chat-hitl-actions"
      sx={{
        mt: 1,
        p: 1.5,
        border: '1px solid',
        borderColor: 'warning.main',
        // eslint-disable-next-line elitea/ad-hoc-radius — warning banner border radius
        borderRadius: 1,
        backgroundColor: 'warning.lighter',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
      }}
    >
      <Typography
        variant="subtitle2"
        sx={{ color: 'warning.dark', fontWeight: 600 }}
      >
        {t('chatMessages.hitlAnswer.title', 'The agent needs an answer to continue')}
      </Typography>
      {questions.length === 0 && message && (
        <Typography
          variant="body2"
          sx={{ color: 'text.primary' }}
        >
          {message}
        </Typography>
      )}
      <AnswerQuestionsControl
        questions={questions}
        disabled={disabled}
        onSubmit={onSubmit}
      />
    </Box>
  );
}
