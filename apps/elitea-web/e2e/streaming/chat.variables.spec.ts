/**
 * The negative twin of `expectStoredAssistantAnswer`: an agent that carries a
 * POPULATED `version_details.variables` entry is a real, reachable user path
 * — the web form has a whole panel for it — and on the native Rust runtime it
 * is REFUSED BY DESIGN, not by bug. This journey pins that refusal so it
 * fails loudly the day the runtime grows variable substitution and stops
 * being true.
 *
 * THE RUNTIME SIDE, traced to source:
 * `services/elitea-worker-rust/src/agents/assembly.rs`'s
 * `validate_application_meta_variables` (:701-712) admits `meta.variables` as
 * `None`/`null`, an empty array, or an empty object — the two empty shapes
 * because Main's UPDATE path writes an empty ARRAY on every re-save while the
 * CREATE path never wrote the key at all, and the function's own doc comment
 * (:683-699) explains why both are treated as "no variables" rather than one
 * of them falling through to the catch-all. A NON-empty array or object of
 * either shape hits the function's last arm and returns `unsupported_profile()`
 * (:965-969) — `NativeAgentAssemblyErrorCode::UnsupportedCapability`, "the
 * authorized agent profile requires a capability that is not admitted yet".
 * Variable substitution is not implemented in this runtime; the refusal says
 * so honestly instead of pretending the input is malformed.
 *
 * WHY THIS IS A LATE REFUSAL, NOT A 422 AT SEND TIME: the admission gates
 * this repository already pins (`services/elitea-main/internal/db/queries/
 * agent_chat.sql`, the version/participant joins `chat.agent.spec.ts` and
 * `chat.agent-tools.spec.ts` exist for) have no opinion on `meta.variables` —
 * they resolve the version row and forward the turn. Only the WORKER, once it
 * actually assembles the run, calls `validate_application_meta_variables` and
 * refuses it. So the observable shape is exactly the one
 * `chat.agent-tools.spec.ts`'s header comment measured for an unsupported
 * internal tool (its defect class 1): START answers 200, a stream opens, and
 * the refusal lands as a STORED assistant row flagged `metadata.is_error`.
 * `expectStoredTurnRefusal` (`e2e/fixtures/api.ts`) is the assertion built for
 * exactly that shape — the mirror image of `expectStoredAssistantAnswer`,
 * which requires the row NOT be flagged.
 *
 * WHY THIS SPEC SETS THE VARIABLE THROUGH THE API, NOT THE FORM: it was
 * supposed to use the form, and does not, because there is no form control
 * that AUTHORS a new variable NAME in this app's ported manual edit page.
 * `ApplicationVariables`/`AgentVariables`
 * (`src/features/agents/ui/ApplicationVariables.tsx`,
 * `AgentVariables.tsx`) both render existing rows only — each returns `null`
 * outright when its `variables` prop is empty, so there is no "add variable"
 * affordance to click. The one place this codebase DOES derive a variable
 * NAME from `{{name}}` placeholders in the instructions text — porting the
 * legacy app's `contextResolver`/`extractPlaceholders`
 * (`src/shared/lib/string.ts`, itself ported from
 * `apps/elitea-ui/src/common/utils.jsx`) — is wired into exactly one flow,
 * the AI-generate-agent draft approval
 * (`src/features/agents/ui/generate-agent-modal/useAgentDraftApproval.ts:151`).
 * The manual `CreateAgentForm`/`InstructionsInput.tsx` path this suite's own
 * `createAgentThroughForm` drives has no such wiring — `InstructionsInput.tsx`
 * does not mention "variable" at all — so typing `{{topic}}` into the
 * instructions box on that page does nothing to `version_details.variables`.
 * Since the same gap means a real user cannot author a NEW variable NAME
 * through this page either way, this journey reaches for the same door the
 * form's own save uses instead: `PUT .../version/prompt_lib/{project}/
 * {application}/{version}` with a `variables` array, exactly the
 * `VersionWriteRequest.variables: VersionVariable[]` shape
 * `useSaveVersion.ts` sends (confirmed against
 * `services/elitea-main/internal/api/v2/applications/handler.go:915-933`,
 * which folds a present `variables` key into `application_versions.meta`
 * — the identical column `assembly.rs` reads). If a variables-authoring
 * control is ever added to this edit page, this spec should switch to
 * driving it, the same way `chat.agent.spec.ts` insists on
 * `createAgentThroughForm` over the API for the fields the form itself seeds.
 *
 * WHERE THIS LIVES: `streaming/`, matched by the `chat-stream` project
 * (`playwright.config.ts`), because an agent turn needs the full standalone
 * stack's runtime plane and a real worker — see `chat.agent.spec.ts`'s header
 * for why the plain `journeys/` stack cannot run this at all.
 */
import { expect, test } from '@playwright/test';

import { BASE_URL } from '../../playwright.config';
import {
  AUTOTEST_PREFIX,
  createAgentThroughForm,
  expectStoredAssistantAnswer,
  expectStoredTurnRefusal,
} from '../fixtures/api';

/** Matched WITHOUT a project id: the chat persona works inside its own personal project (#290). */
const START_RE = /\/elitea_core\/messages\/prompt_lib\/(\d+)\/[0-9a-f-]+/;
const CONVERSATION_CREATED_RE = /\/elitea_core\/conversations\/prompt_lib\/\d+$/;

test('an agent with a populated variable is admitted, then refused by the runtime as unsupported', async ({ page }) => {
  test.setTimeout(180_000);

  const name = `${AUTOTEST_PREFIX}vars-${Date.now() % 1_000_000}`;
  const variableName = 'topic';
  const variableValue = `${AUTOTEST_PREFIX}value`;

  // ── 1. Author the agent through the form ────────────────────────────────
  const { projectId, agentId, versionId } = await createAgentThroughForm(page, name);

  // ── 2. Give the version ONE populated variable — through the version PUT, ─
  //      the same door the form's own save uses, and the only one available
  //      (see the header comment for why the form has no add-variable
  //      control to click).
  const putResponse = await page.request.put(
    `${BASE_URL}/api/v2/elitea_core/version/prompt_lib/${projectId}/${agentId}/${versionId}`,
    { data: { variables: [{ name: variableName, value: variableValue }] } },
  );
  expect(
    putResponse.status(),
    `the version must accept a variable: ${(await putResponse.text()).slice(0, 300)}`,
  ).toBeLessThan(300);

  // What the server STORED, not what this test sent — the same discipline
  // `createAgentThroughForm` uses for `internal_tools`.
  const putBody = (await putResponse.json()) as { variables?: readonly { name?: string; value?: string }[] };
  expect(
    putBody.variables ?? [],
    'the variable must round-trip through the write, or the refusal below would not be about variables at all',
  ).toEqual([{ name: variableName, value: variableValue }]);

  // ── 3. Open chat with this agent from its own edit page ────────────────
  const conversationCreated = page.waitForResponse(
    (r) => CONVERSATION_CREATED_RE.test(new URL(r.url()).pathname) && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await page.getByTestId('chat-with-agent-button').click();
  const conversation = (await (await conversationCreated).json()) as { id?: string | number };
  const conversationId = String(conversation.id ?? '');
  expect(conversationId, 'the Chat button must create a conversation to attach to').not.toBe('');
  await page.waitForURL(new RegExp(`/app/chat/${conversationId}$`), { timeout: 30_000 });

  // ── 4. Send, and require the turn to be ADMITTED ────────────────────────
  // The admission gates (the version/participant joins) have no opinion on
  // `meta.variables` — only the worker does, once it actually assembles the
  // run — so a populated variable must NOT be refused here.
  const started = page.waitForResponse(
    (r) => START_RE.test(r.url()) && r.request().method() === 'POST',
    { timeout: 45_000 },
  );
  const input = page.getByTestId('chat-message-input');
  await expect(input).toBeEditable({ timeout: 20_000 });
  await input.fill(`autotest variables ${Date.now()}`);
  await page.getByTestId('chat-send-button').click();

  const startResponse = await started;
  expect(
    startResponse.status(),
    `a populated variable must not be refused at admission: ${(await startResponse.text()).slice(0, 300)}`,
  ).toBe(200);

  // ── 5. …and require the RUNTIME to refuse it ────────────────────────────
  // The negative twin of `expectStoredAssistantAnswer`: this run must NOT
  // finalize an ordinary answer — it must finalize a row `metadata.is_error`
  // flags true. If this ever fails because the row instead carries a real
  // answer, `validate_application_meta_variables` no longer refuses a
  // populated `variables` array, and this spec — not just its assertion —
  // needs to be flipped to expect success.
  // The two workers pin OPPOSITE contracts here, both by design: the native
  // runtime refuses a populated variables array
  // (validate_application_meta_variables), while the SDK worker substitutes
  // the variables and answers. E2E_WORKER comes from chat-stream-e2e.sh, the
  // one place that knows which worker the stack runs; the local default is
  // the native runtime, matching the long-lived dev stack.
  if ((process.env['E2E_WORKER'] ?? 'rust') === 'rust') {
    await expectStoredTurnRefusal(page, projectId, conversationId, {
      timeout: 90_000,
      message:
        'the native runtime answered a variable it does not support — ' +
        'validate_application_meta_variables no longer refuses a populated variables array, ' +
        'so this spec pins a refusal that is no longer true and must be flipped',
    });
  } else {
    await expectStoredAssistantAnswer(page, projectId, conversationId, {
      timeout: 90_000,
      message:
        'the SDK worker serves populated variables — a refusal here means variable ' +
        'substitution broke on the python leg',
    });
  }

  await page.request.delete(
    `${BASE_URL}/api/v2/elitea_core/application/prompt_lib/${projectId}/${agentId}`,
  );
});
