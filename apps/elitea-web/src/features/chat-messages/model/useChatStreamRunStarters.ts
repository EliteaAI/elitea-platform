/**
 * model/useChatStreamRunStarters.ts — the REST calls that begin a run, and what
 * a failure from one of them means (issue #93, Surface B).
 *
 * Split out of `model/useChatStreamTransport.ts` to keep that file inside the
 * §3.5 file-length budget of 400 lines — the same move `lib/chatStreamSettle.ts`
 * records in its own header. The seam is one family: the three admission routes
 * (start, resume, regenerate) and the classification that turns their errors
 * into the caller's fallback decision. Everything downstream of an accepted
 * run — the stream, the frames, the ownership — stays with the transport,
 * which passes in `subscribeToRun` as its half of the handshake.
 *
 * FALLBACK IS PART OF THE CONTRACT, not defensiveness. `startAgentExecution`'s
 * own doc states it: the Go route REQUIRES a recognised `execution_contract`
 * and 400s without one, which is what makes any failure — or a 200 carrying no
 * `events_url` — an unambiguous "this backend has not landed the SSE path".
 * `start` reports that by returning `false`, and the caller then emits
 * `chat_predict` exactly as before. A backend mid-migration keeps working.
 *
 * A REFUSAL IS NOT AN ABSENT TRANSPORT, which is why the classification below
 * is not a single try/catch. Only 404/405 mean "this route does not exist
 * here"; a 422 naming an unsupported agent, a 403, or an unreachable service
 * are the server ANSWERING, and repeating that question over the socket would
 * ask a backend that already refused to run the same turn a second way.
 */
import { useCallback, useMemo } from "react";

import {
  AGENT_REGENERATE_CONTRACT,
  continueAgentExecution,
  regenerate as regenerateConversation,
  startAgentExecution,
  type AgentExecutionStart,
  type ContinueAgentExecutionParams,
  type StartAgentExecutionParams,
} from "@/entities/conversation/api/conversationApi";
import { EliteaApiError } from "@/shared/api/generated/mutator";

/** Result of starting a run before the widget decides whether socket fallback is safe. */
export type AgentStreamStartAttempt =
  | { readonly started: true }
  | { readonly started: false; readonly reason: "no-transport" }
  | {
      readonly started: false;
      readonly reason: "rejected";
      readonly message: string;
    };

const STARTED: AgentStreamStartAttempt = { started: true };
const NO_TRANSPORT: AgentStreamStartAttempt = {
  started: false,
  reason: "no-transport",
};

function serverFailureMessage(body: unknown, status: number): string {
  if (typeof body === "object" && body !== null) {
    const value = body as Readonly<Record<string, unknown>>;
    for (const field of ["safe_message", "message", "error"] as const) {
      if (typeof value[field] === "string" && value[field].trim() !== "")
        return value[field];
    }
  }
  return `The agent run could not start (HTTP ${status}).`;
}

/** @public Exported for its own test: the fallback decision is the contract here. */
export function classifyStartFailure(error: unknown): AgentStreamStartAttempt {
  if (!(error instanceof EliteaApiError)) return NO_TRANSPORT;
  const failure = error.failure;
  if (failure.kind === "http") {
    if (failure.status === 404 || failure.status === 405) return NO_TRANSPORT;
    return {
      started: false,
      reason: "rejected",
      message: serverFailureMessage(failure.body, failure.status),
    };
  }
  if (failure.kind === "auth") {
    return {
      started: false,
      reason: "rejected",
      message: "This session is not authorized to start the agent run.",
    };
  }
  if (failure.kind === "network") {
    return {
      started: false,
      reason: "rejected",
      message: "The agent service could not be reached.",
    };
  }
  return {
    started: false,
    reason: "rejected",
    message: "The agent start request was cancelled.",
  };
}

/**
 * A string worth carrying, or nothing.
 *
 * Both an outgoing request body and an incoming durable frame type their
 * `question_id` as `unknown`, and both use `""` where the id is absent, so the
 * same reading applies to either side of the wire.
 */
export function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The transport's half: take ownership of an accepted run's stream. Answers
 * `false` only when the accepting response carried no stream to watch.
 */
export type SubscribeToChatRun = (
  accepted: AgentExecutionStart,
  conversationUuid: string,
  projectId: string | number,
  questionId?: string,
) => boolean;

/** @public Arguments for regenerating one persisted answer. */
export interface ChatStreamRegenerateParams {
  readonly projectId: string | number;
  readonly conversationUuid: string;
  readonly responseMessageId: string;
  readonly body: Readonly<Record<string, unknown>>;
}

/** @public The three ways a run is admitted, plus `start`'s boolean shorthand. */
export interface ChatStreamRunStarters {
  /** Start with the distinction between an absent transport and a server refusal. */
  readonly startDetailed: (
    params: StartAgentExecutionParams,
  ) => Promise<AgentStreamStartAttempt>;
  /**
   * Start a run over REST and take ownership of its stream.
   *
   * `true` ⇒ this transport owns the run and the caller must NOT emit
   * `chat_predict`. `false` ⇒ the backend serves no replay stream; fall back.
   */
  readonly start: (params: StartAgentExecutionParams) => Promise<boolean>;
  /**
   * Resume a run this backend PAUSED, and take ownership of its stream.
   *
   * `true` ⇒ the route accepted the resume and the caller must NOT emit
   * `chat_continue_predict`; a second resume would run the agent twice.
   * `false` ⇒ the route refused or does not exist; fall back to the socket.
   *
   * A 200 that carries no `events_url` still answers `true`. The run IS live
   * again server-side, which is the half that must not be repeated; only the
   * live view of it is missing.
   */
  readonly resume: (params: ContinueAgentExecutionParams) => Promise<boolean>;
  /** Regenerate one persisted answer and take ownership of its replacement stream. */
  readonly regenerate: (params: ChatStreamRegenerateParams) => Promise<boolean>;
}

export function useChatStreamRunStarters(
  subscribeToRun: SubscribeToChatRun,
): ChatStreamRunStarters {
  const startDetailed = useCallback(
    async (
      startParams: StartAgentExecutionParams,
    ): Promise<AgentStreamStartAttempt> => {
      let started: AgentExecutionStart;
      try {
        started = await startAgentExecution(startParams);
      } catch (error) {
        return classifyStartFailure(error);
      }
      // A 200 with no events_url is the same signal — an older backend answering
      // the same route. Treating it as success would leave the run unwatched.
      return subscribeToRun(
        started,
        startParams.conversationUuid,
        startParams.projectId,
        nonEmptyString(startParams.body["question_id"]),
      )
        ? STARTED
        : NO_TRANSPORT;
    },
    [subscribeToRun],
  );

  const start = useCallback(
    async (startParams: StartAgentExecutionParams): Promise<boolean> =>
      (await startDetailed(startParams)).started,
    [startDetailed],
  );

  const resume = useCallback(
    async (resumeParams: ContinueAgentExecutionParams): Promise<boolean> => {
      let resumed: AgentExecutionStart;
      try {
        resumed = await continueAgentExecution(resumeParams);
      } catch {
        // The route refused the resume, or this backend does not serve it. The
        // caller falls back to `chat_continue_predict`.
        return false;
      }
      // The route ACCEPTED the resume. The run is live again whether or not the
      // answer named a stream, so the caller must not resume it a second time.
      subscribeToRun(
        resumed,
        resumeParams.conversationUuid,
        resumeParams.projectId,
        nonEmptyString(resumeParams.body["question_id"]),
      );
      return true;
    },
    [subscribeToRun],
  );

  const regenerate = useCallback(
    async (params: ChatStreamRegenerateParams): Promise<boolean> => {
      let accepted: AgentExecutionStart;
      try {
        accepted = await regenerateConversation({
          ...params.body,
          projectId: params.projectId,
          id: params.responseMessageId,
          executionContract: AGENT_REGENERATE_CONTRACT,
        });
      } catch {
        return false;
      }
      // The contract was accepted, so the run exists even when an older server
      // omits its replay URL. Never start the same regeneration over a socket.
      subscribeToRun(
        accepted,
        params.conversationUuid,
        params.projectId,
        nonEmptyString(params.body["question_id"]),
      );
      return true;
    },
    [subscribeToRun],
  );

  return useMemo(
    () => ({ startDetailed, start, resume, regenerate }),
    [startDetailed, start, resume, regenerate],
  );
}
