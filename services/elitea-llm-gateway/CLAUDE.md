# CLAUDE.md — elitea-llm-gateway

Standing rules for any agent working in this module. These are decisions already
made (see DECISIONS.md for rationale) — apply them WITHOUT re-asking. They exist
because each was a real bug found across 3 review rounds.

## Build / test (non-negotiable)
- This is a **standalone Go 1.26.4 module, NOT in the root go.work.** ALWAYS build
  and test with `GOWORK=off` (e.g. `GOWORK=off go test -race ./...`,
  `GOWORK=off golangci-lint run ./...`). Plain `go test` from the workspace fails.
- Before claiming done, BOTH must be green: `GOWORK=off go test -race ./...` AND
  `GOWORK=off golangci-lint run ./...`. `go vet`/`go test` alone is not enough —
  CI runs golangci-lint and it has caught real bugs (ineffassign, errcheck).

## Money path (correctness-critical)
- Money is **int64 nano-USD end to end**. NEVER introduce a float on the money
  path. Prices are **per-1M tokens** (guard the 1000× denomination bug).
- Use `math/big` where an int64 multiply could overflow; guard `big.Int.Int64()`
  with `IsInt64()`.

## Enforcement policy (do not weaken without a human)
- **Fail CLOSED** on a budget-store / Postgres read error while NATS is up — never
  substitute a zero/unlimited snapshot. A DB blip must not grant unlimited spend.
- Budget gate runs **before** the provider on EVERY /llm endpoint (chat,
  responses, text, embeddings, images, messages). Adding a new endpoint? It MUST
  call checkBudget before dispatch and updateUsage after.
- The model a caller sends is **mapped to the provider's own model name before
  dispatch** (`mapModel`, internal/llmproxy/modelmap.go). Adding a new endpoint
  that carries a model? It MUST call `mapModel` after the decode and BEFORE
  `checkBudget` — the provider must not see an unmapped id, and the cost tables
  are keyed by the provider's name. Do not make the unreadable-model-set path
  fail closed without a human (DECISIONS.md, "Model-name mapping").
- `mapModel` gates every dialect against ONE model set, built from the
  `(section, type)` pairs in `addressableModelSections`
  (internal/llmproxy/models.go). Add the pair there when you add a route that
  dispatches a new kind of model, and add its case to
  `addressableSectionCases()` in `model_sections_test.go`. A missing pair makes
  the gateway answer 404 `model_not_found` for a model the project configured
  correctly — that is how /llm/v1/embeddings and /llm/v1/images/* broke. Do NOT
  work around it by seeding the model as an `llm`/`llm_model` row: those rows are
  the chat catalogue the web model picker reads.
- Error bodies are **OpenAI-shaped on ALL /llm routes** (spec §2.5): nested
  `{"error":{"message","type","code"}}`. 402=budget_exceeded/insufficient_quota,
  429=rate_limit_error/rate_limit_exceeded, 503=service_unavailable/nats_unavailable.
  Do NOT emit Anthropic-shaped errors on /llm/v1/messages.

## Security / trust boundary
- The edge (elitea-main) trusts `X-Auth-*` / `X-Elitea-*` ONLY from a configured
  trusted proxy (`TRUSTED_PROXY_CIDRS`, checked against RemoteAddr, deny-by-default).
  Strip client-supplied Cookie/Authorization/X-Api-Key/X-Auth-*/X-Elitea-* before
  proxying; the gateway sees only edge-signed identity.
- Never log credentials/tokens/master keys or a URL containing userinfo (redact).

## Wiring (the bug class that recurred 3×)
- Any lifecycle method (Start/Drain/DrainBilling/Close) that must run to be
  effective MUST be called from the composition root (`cmd/.../main.go`) AND
  guarded by the wiring test in `cmd/elitea-llm-gateway/main_test.go`
  (`TestMainWiring`). A unit test proving the method works in ISOLATION does not
  prove main() calls it. When you add such a method, add its assertion there.
- Any env var the code reads (config.go / vault.go) MUST either be settable by the
  Helm chart (`deploy/helm/elitea-llm-gateway/values.yaml`) or be on
  `scripts/env-drift-allowlist.txt` with a justification. `scripts/env-drift-check.sh`
  enforces this in CI.

## Language (ASD-STE100)
Write ALL agent-authored text in ASD-STE100 Simplified Technical English: GitHub
issues, PR bodies, review comments, commit messages, and documentation edits.
Rules that apply here:
- Write short sentences (max 20 words for an instruction, max 25 for a description).
- Give one instruction per sentence. Use the active voice and the present tense.
- Use one approved term for one thing; do not switch between synonyms.
- Start an instruction with the verb (e.g. "Set GOWORK=off before you build").
Code identifiers, file paths, log excerpts, and quoted output are exempt.

## Autonomy boundary (for agent-driven review/fix loops)
An agent may run review→fix→verify→push autonomously ONLY within these limits:
- Fix only findings tagged **autoFixable** (mechanical: wiring, error handling,
  test strengthening, doc/lint). 
- **NEVER** change, autonomously, any of: the fail-open/closed policy, the trust
  boundary / CIDR model, the money denomination, the async-billing overshoot
  bound, or anything in DECISIONS.md marked "human decision". Escalate those.
- Only advance while CI stays green; if a gate goes red, stop and report.
- Verify every fix against its own gate (`-race`, lint, the wiring/env/coverage
  gates) before committing — do not trust a subagent's self-report.
