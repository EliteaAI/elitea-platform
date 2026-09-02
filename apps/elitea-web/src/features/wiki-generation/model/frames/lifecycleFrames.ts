/**
 * start_task — the frame that opens a run.
 *
 * The task id is persisted as an EFFECT rather than written here, because the
 * legacy code wrote it to both a ref and to durable per-toolkit state, and only
 * the second survives a page reload. DWIKI-006 is the item that depends on it.
 */
import type { GenerationFrame, GenerationResult, GenerationState } from '../types';
import { asRecord } from './shared';

export function reduceStartTask(
  state: GenerationState,
  frame: GenerationFrame,
): GenerationResult {
  const taskId = asRecord(frame.content)?.task_id;
  const hasTaskId = typeof taskId === 'string' && taskId !== '';
  return {
    state: {
      ...state,
      taskId: hasTaskId ? taskId : state.taskId,
      status: { status: 'running', message: 'Wiki generation started...' },
    },
    effects: hasTaskId ? [{ kind: 'persistTaskId', taskId }] : [],
  };
}
