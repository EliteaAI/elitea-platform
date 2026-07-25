# Elitea LLM Gateway — LiteLLM→Bifrost Migration

## Goal

Migrate the `/llm` surface from LiteLLM to a **standalone `elitea-llm-gateway`** service
that embeds `bifrost/core`, runs as N stateless replicas, and coordinates shared state
through **NATS JetStream**. `elitea-main` stays a lightweight auth edge + streaming reverse
proxy. Deployment is the **scale-1** profile; cutover is **big-bang** (no shadow, no canary,
no per-project cutover state). The `/llm` wire contract stays byte-compatible — zero SDK changes.

## Specifications

The authoritative design lives in `elitea-docs/docs/internal/03-architecture/llm-gateway/`:
- `adr-0015-bifrost-gateway-migration.mdx` — the decision (Option E) + options + risk table
- `design-bifrost-gateway.mdx` — request flow, NATS counters + write-behind, fail-mode FSM, deployment (§8.1.1 profiles, §9.5 settings)
- `spec-bifrost-migration.mdx` — normative `/llm` contract, budget/rate contract, big-bang cutover gates, the Ralph task tree (§7)
- `runbook-bifrost-cutover.mdx` — pre-flight, cutover, rollback, incident response

Read the relevant doc for the task you are on before writing code.

## Current Task

Check @.ralph/ralph-tasks.md starting from Phase BF-Build.
Find the NEXT uncompleted top-level task (`- [ ]`).
Complete ONLY that ONE task and its subtasks, then STOP.

**BF-Build must be green before BF-PF; BF-PF must be green before BF-C.**

> **BF0.3a (SSE incremental flush) is the biggest technical unknown and gates cutover.**
> If it cannot flush per-chunk through the converter + net/http + reverse-proxy path,
> STOP and emit `<promise>NEEDS_DECOMPOSITION</promise>` — do not fake a passing test.

---

## Rules (MUST follow)

### 1. One Task Per Loop

- Work on exactly ONE top-level task (e.g., "BF0.2a Implement elitea-main → gateway streaming reverse proxy")
- Complete ALL its subtasks before signaling done
- Do NOT start the next top-level task in the same iteration
- **If a task has NO subtasks** (just a single line), STOP and emit `<promise>NEEDS_DECOMPOSITION</promise>` instead. Do not improvise subtasks — wait for human to decompose it.

### 2. Search Before Implementing

- Before writing ANY new code, search the codebase for existing implementations:
  ```
  grep -r "pattern" services/ centry/
  find . -name "relevant_file" -type f
  ```
- Check if a utility, pattern, or module already exists that does what you need
- Reuse existing patterns from @.ralph/AGENT.md
- **Use context7** to look up current library documentation before using any external library API (bifrost, nats.go, chi, gobreaker, GORM, etc.). This prevents using deprecated or incorrect API patterns.
- **The Bifrost `integrations` `Create*RouteConfigs` factories require a fasthttp `lib.HandlerStore` and are NOT callable from chi/net-http** (design §6.3). Decode bodies into dialect structs and call `bifrost/core` methods directly. Consult the converter types for wire-shape only.
- **Think step-by-step** before complex implementations (SSE flush, budget FSM, write-behind consumer, RAFT/quorum semantics, race conditions). Write out the sequence of operations and failure modes BEFORE writing code.

### 3. No Placeholder Code

- Every function must have a complete, working implementation
- NEVER write `pass`, `TODO`, `FIXME`, `NotImplementedError`, or stub functions
- If you cannot fully implement something, skip it and explain why in a comment

### 4. Scope Containment

- Only modify files directly related to the current task
- Do NOT refactor, rename, or restructure unrelated code
- Do NOT change formatting, imports, or style in files you didn't create
- If you discover a bug elsewhere, note it in AGENT.md but don't fix it now

### 5. Update Knowledge Base

- After completing a task, append learnings to `@.ralph/AGENT.md` under "Learnings Log"
- Record: file paths discovered, patterns used, gotchas encountered
- This helps future iterations avoid repeating research

### 6. Rollback on Failure

- If tests fail after 2 attempts at fixing, `git checkout` the broken files
- Try a completely different approach
- If still stuck after 3 approaches, mark the task with `[!]` and move to the next one

---

## Workflow Per Task

1. Read the task and all its subtasks from ralph-tasks.md
2. Read the referenced design/spec section
3. Search the codebase for relevant existing code
4. Implement all subtasks within the current top-level task
5. Write unit tests achieving >=85% coverage for new code
6. Run validation: `python .ralph/validate.py --phase phase-bifrost-build`
7. Mark completed subtasks with `[x]` in ralph-tasks.md
8. Update AGENT.md with learnings
9. Commit with conventional commit format: `feat(gateway): description`

---

## Key Repositories / Paths

| Area | Path | Notes |
|------|------|-------|
| gateway service (new) | `services/elitea-llm-gateway/` | Go 1.26.4 module; embeds bifrost/core; NOT public |
| edge | `services/elitea-main/` | auth edge + reverse proxy; toolchain UNCHANGED (do not bump Go here) |
| cutover CLI | `services/elitea-main/cmd/cutover-ctl/` | gate subcommands (sse-flush-check, cost-parity, models-parity, overhead-check, budget-check, cutover-verify, budget-status-audit) — mostly greenfield |
| scheduler | `elitea-scheduler` (write-behind consumer) | budget-writeback durable pull consumer |
| admin schemas / UI | `services/elitea-main/internal/api/v2/admin/`, `admin_ui/src/SchemaForm/` | governance config-authoring (BF0.6) |
| proto | `proto/elitea/gateway/v1/gateway.proto` | BF0.7 |

Confirm the actual on-disk layout with `find`/`grep` before assuming a path exists — some of these are greenfield.

### Git Workflow Per Repo

```bash
# Commit in the repo you changed; conventional commits. Do NOT push (no push until review).
git add -A && git commit -m "feat(gateway): ..."
```

## Architecture Constraints (current design — Option E)

- **NATS JetStream** is the shared-state substrate (NOT Redis/Valkey on the gateway path). NATS Server **2.12.0+** required for `Nats-Incr`. Context `nats --context gateway`.
- Budget counters are **int64 nano-USD** (`NanoUSD = 1e9`) via `Nats-Incr` in KV bucket `GATEWAY_BUDGET`; write-behind stream `GATEWAY_BUDGET_DELTAS` (durable consumer `budget-writeback`, `Nats-Msg-Id` dedup); cooldown KV `GATEWAY_ALERT_COOLDOWN`; events on `gateway.events.*`. There is **no** `GATEWAY_CUTOVER` bucket.
- Hard block is **HTTP 402** (surfaced by the gateway; `elitea-main` byte-streams it through). Error body: `type=budget_exceeded, code=insufficient_quota`.
- `LLM_BUDGET_EXPECTED_REPLICAS` default **1** (scale-1); HA operators MUST override to the real replica count.
- Prices are **per-1M tokens** (`input_cost_per_1m_tokens`) — never per-1k (guards the 1000× bug).
- Internal transport is an **mTLS HTTP/1.1 streaming reverse proxy** (`FlushInterval < 0`), NOT gRPC.
- **PostgreSQL**: connection via `$DATABASE_URL` (used by the BF0.4 migration validator).

## Patterns

See @.ralph/AGENT.md for accumulated patterns and learnings.

## Quality Requirements

- >=85% test coverage for new gateway code (BF0.6t gate)
- Conventional commits: `feat(gateway):`, `test(gateway):`, `fix(gateway):`
- No hardcoded secrets; provider keys come from the Fernet vault via the `Account` interface
- Every NATS KV op is bounded (`context.WithTimeout(ctx,150ms)`); connection Timeout=1s

## Completion Signals

When current top-level task is complete: <promise>READY_FOR_NEXT_TASK</promise>
When ALL BF-Build tasks are complete: <promise>COMPLETE</promise>
