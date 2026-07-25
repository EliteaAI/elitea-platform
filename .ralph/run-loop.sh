#!/usr/bin/env bash
#
# Simple implementation loop using Claude Code directly
# Avoids Ralph's model validation issues with Bedrock IDs
#
# Usage:
#   ./run-loop.sh                    # Default (Sonnet)
#   ./run-loop.sh --model opus       # Use Opus
#   ./run-loop.sh --max-iterations 50
#

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RALPH_DIR="$PROJECT_ROOT/.ralph"

# --- Local validator environment (override by exporting before running) ---
# psql client (libpq is keg-only on Homebrew) for the BF0.4 migration gate.
[ -d /opt/homebrew/opt/libpq/bin ] && export PATH="/opt/homebrew/opt/libpq/bin:$PATH"
# Live Postgres for schema-introspection validators (BF0.4). Points at the
# local pgvector container `gw-pg` (podman) on 5433. Override to target another DB.
: "${DATABASE_URL:=postgres://centry:centry@localhost:5433/centry?sslmode=disable}"
export DATABASE_URL
# Optional per-machine overrides (git-ignored); create .ralph/env.local.sh if needed.
[ -f "$RALPH_DIR/env.local.sh" ] && . "$RALPH_DIR/env.local.sh"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Model mapping
get_model_id() {
    case "$1" in
        opus)   echo "eu.anthropic.claude-opus-4-8" ;;
        sonnet) echo "eu.anthropic.claude-sonnet-4-6" ;;
        haiku)  echo "eu.anthropic.claude-haiku-4-5-20251001-v1:0" ;;
        *)      echo "$1" ;;
    esac
}

# Defaults
MODEL="sonnet"
MAX_ITERATIONS=100
MIN_ITERATIONS=2
PHASE=""

# Parse args
while [[ $# -gt 0 ]]; do
    case $1 in
        --model) MODEL="$2"; shift 2 ;;
        --max-iterations) MAX_ITERATIONS="$2"; shift 2 ;;
        --min-iterations) MIN_ITERATIONS="$2"; shift 2 ;;
        --phase) PHASE="$2"; shift 2 ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --model MODEL        Model: opus, sonnet, haiku (default: sonnet)"
            echo "  --max-iterations N   Maximum iterations (default: 100)"
            echo "  --min-iterations N   Minimum per task (default: 2)"
            echo "  --phase N            Run specific phase only (1-5)"
            echo ""
            echo "Models (Bedrock EU):"
            echo "  opus   -> eu.anthropic.claude-opus-4-8"
            echo "  sonnet -> eu.anthropic.claude-sonnet-4-6"
            echo "  haiku  -> eu.anthropic.claude-haiku-4-5-20251001-v1:0"
            exit 0
            ;;
        *) shift ;;
    esac
done

cd "$PROJECT_ROOT"

FULL_MODEL_ID=$(get_model_id "$MODEL")

# Build prompt. Default (no --phase) uses the Bifrost PROMPT.md as-is.
# --phase accepts a Bifrost phase: build | preflight | cutover (or the full
# phase id, e.g. phase-bifrost-build). It reuses PROMPT.md with a focus note —
# it does NOT regenerate a different project's prompt.
PROMPT_FILE="$RALPH_DIR/PROMPT.md"
if [[ -n "$PHASE" ]]; then
    case "$PHASE" in
        build|phase-bifrost-build)         PHASE_ID="phase-bifrost-build" ;;
        preflight|pf|phase-bifrost-preflight) PHASE_ID="phase-bifrost-preflight" ;;
        cutover|phase-bifrost-cutover)     PHASE_ID="phase-bifrost-cutover" ;;
        *) echo "Unknown phase '$PHASE'. Use: build | preflight | cutover"; exit 1 ;;
    esac
    PROMPT_FILE="$RALPH_DIR/PROMPT_PHASE_${PHASE_ID}.md"
    {
        cat "$RALPH_DIR/PROMPT.md"
        echo ""
        echo "---"
        echo ""
        echo "## Phase focus (this run)"
        echo ""
        echo "Work ONLY within phase \`${PHASE_ID}\`. Find the NEXT uncompleted top-level"
        echo "task in that phase in @.ralph/ralph-tasks.md and complete only it."
        echo "Validate with: \`python .ralph/validate.py --phase ${PHASE_ID}\`"
    } > "$PROMPT_FILE"
fi

log_info "Starting implementation loop"
log_info "  Model:      $MODEL -> $FULL_MODEL_ID"
log_info "  Phase:      ${PHASE:-all}"
log_info "  Max Iters:  $MAX_ITERATIONS"
echo ""

iteration=0
task_iterations=0
completed=false
prev_score=""
total_features=$(python3 -c "import json; d=json.load(open('$RALPH_DIR/features.json')); print(sum(len(p['features']) for p in d['phases']))" 2>/dev/null || echo "39")

while [[ $iteration -lt $MAX_ITERATIONS ]] && [[ "$completed" != "true" ]]; do
    iteration=$((iteration + 1))
    task_iterations=$((task_iterations + 1))

    # Find current task name from ralph-tasks.md
    current_task=$(grep -m1 '^\- \[ \]' "$RALPH_DIR/ralph-tasks.md" 2>/dev/null | sed 's/- \[ \] //' | head -c 60)
    if [[ -z "$current_task" ]]; then
        current_task="(all tasks checked)"
    fi

    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    log_info "Iteration $iteration/$MAX_ITERATIONS (task iter: $task_iterations)"
    log_info "Working on: $current_task"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""

    # Run Claude Code with the prompt, showing a live elapsed timer
    start_time=$(date +%s)

    # Run in background so we can show elapsed time
    output_file=$(mktemp)
    claude --model "$FULL_MODEL_ID" --print --dangerously-skip-permissions \
        "$(cat "$PROMPT_FILE")" > "$output_file" 2>&1 &
    claude_pid=$!

    # Show elapsed timer while Claude is running
    while kill -0 "$claude_pid" 2>/dev/null; do
        elapsed=$(( $(date +%s) - start_time ))
        printf "\r  ⏱  Elapsed: %dm %02ds" $((elapsed/60)) $((elapsed%60))
        sleep 5
    done
    wait "$claude_pid" || true
    printf "\r                              \r"

    output=$(cat "$output_file")
    rm -f "$output_file"

    end_time=$(date +%s)
    duration=$((end_time - start_time))

    log_info "Iteration completed in ${duration}s ($(( duration / 60 ))m $(( duration % 60 ))s)"

    # Check for COMPLETE signal
    if echo "$output" | grep -q "<promise>COMPLETE</promise>"; then
        # Verify ALL validators actually pass before accepting completion
        log_info "COMPLETE signal detected - verifying all validators pass..."

        validation_output=$(python3 "$RALPH_DIR/validate.py" --dashboard 2>&1)
        total_features=$(python3 -c "import json; d=json.load(open('$RALPH_DIR/features.json')); print(sum(len(p['features']) for p in d['phases']))" 2>/dev/null || echo "38")

        if echo "$validation_output" | grep -q "100%.*${total_features}/${total_features}"; then
            log_success "All $total_features validators pass - Implementation COMPLETE!"
            completed=true
            break
        else
            log_warn "COMPLETE signal rejected - not all validators pass!"
            log_warn "Agent must fix remaining validators before completion."
            echo "$validation_output"
            # Continue the loop - don't accept premature completion
            continue
        fi
    fi

    # Check for READY_FOR_NEXT_TASK signal
    if echo "$output" | grep -q "<promise>READY_FOR_NEXT_TASK</promise>"; then
        # Verify progress actually increased
        new_score=$(python3 -c "
import json, subprocess, sys
result = subprocess.run([sys.executable, '$RALPH_DIR/validate.py', '--dashboard'], capture_output=True, text=True)
# Extract X/Y from OVERALL line
import re
m = re.search(r'(\d+)/(\d+)\s*$', result.stdout.strip().split('\n')[-2] if result.stdout.strip() else '')
print(m.group(1) if m else '0')
" 2>/dev/null || echo "0")

        if [[ -n "$prev_score" ]] && [[ "$new_score" == "$prev_score" ]]; then
            log_warn "Task signaled complete but validator score unchanged ($new_score). Retrying..."
            # Don't reset task_iterations — keep working on the same task
            continue
        fi

        prev_score="$new_score"
        log_success "Task complete! Moving to next task... (validators: $new_score/$total_features)"
        task_iterations=0

        # Show progress
        python3 "$RALPH_DIR/validate.py" --dashboard 2>/dev/null || true
        continue
    fi

    # Check for NEEDS_DECOMPOSITION signal — task has no subtasks, human must decompose
    if echo "$output" | grep -q "<promise>NEEDS_DECOMPOSITION</promise>"; then
        log_warn "Agent hit a task that needs decomposition. Stopping loop."
        log_warn "Add subtasks to ralph-tasks.md for the next phase, then restart."
        python3 "$RALPH_DIR/validate.py" --dashboard 2>/dev/null || true
        break
    fi

    # Check minimum iterations per task
    if [[ $task_iterations -lt $MIN_ITERATIONS ]]; then
        log_info "Continuing task (iteration $task_iterations/$MIN_ITERATIONS minimum)"
        continue
    fi

    # Check for errors
    if echo "$output" | grep -qi "error.*401\|authentication failed"; then
        log_error "Authentication error detected!"
        echo "$output" | tail -10
        break
    fi

    log_info "No completion signal, continuing..."
done

echo ""
echo "═══════════════════════════════════════════════════════════════"
if [[ "$completed" == "true" ]]; then
    log_success "Implementation finished!"
else
    log_warn "Stopped after $iteration iterations"
fi
echo "═══════════════════════════════════════════════════════════════"

# Final status
python3 "$RALPH_DIR/validate.py" --dashboard 2>/dev/null || true
