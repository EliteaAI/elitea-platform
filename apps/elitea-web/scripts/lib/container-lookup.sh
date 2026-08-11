# shellcheck shell=bash
#
# Resolve exactly ONE container name out of a compose `ps` listing (#228).
#
# Why this is not `grep -m1`
# --------------------------
# `grep -m1` closes the pipe as soon as it matches. If the producer is still
# writing, it takes SIGPIPE and the PIPELINE exits 141 — a failure under
# `set -o pipefail`, even though the match succeeded. So this idiom:
#
#     name=$( cmd | grep -m1 "$PROJECT.*postgres" || \
#             cmd | grep -m1 'postgres' || true )
#
# runs its fallback IN ADDITION to the successful first branch, and `name` ends
# up holding BOTH names joined by a newline:
#
#     no container with name or ID "nav225-postgres-1\ncentry-postgres-1"
#
# It only reproduces when the producer has enough output to still be writing —
# i.e. when several stacks are running. CI runs one stack under docker and never
# sees it, which is why this survived. It is also self-defeating: the fallback
# exists so the lookup still works when the project prefix does not match, but
# under `pipefail` it fires *as well as* the match, so more isolation made the
# bug MORE likely rather than less.
#
# awk reads to EOF, so the producer is never signalled, and one pass picks the
# preferred name — there is no second command to disagree with the first.
#
# Selection order (unchanged from the `grep -m1` intent):
#   1. the first name matching BOTH the project prefix and the service pattern
#   2. otherwise the first name matching the service pattern alone
#   3. otherwise empty
#
# Arguments are treated as awk regular expressions, matching the previous
# behaviour (callers pass patterns like `postgres` and `elitea-main`).
resolve_container_name() {
  local project="$1" service="$2" names="$3"

  awk -v proj="$project" -v svc="$service" '
    $0 !~ svc { next }
    {
      if (proj != "" && $0 ~ proj && scoped == "") scoped = $0
      if (any == "") any = $0
    }
    END { if (scoped != "") print scoped; else if (any != "") print any }
  ' <<EOF
$names
EOF
}
