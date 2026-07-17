# ELITEA Python runtime worker

## Redis command stream lifecycle

Runtime v1 permits one worker consumer group per Redis command stream. The
group may contain any bounded number of worker consumers or pods. A worker
reads or reclaims one of the bounded reference-only commands, completes the
business operation and durable settlement, then retires that exact stream
entry with `XACK` and `XDEL` in one Redis `MULTI`/`EXEC` transaction. It treats
anything other than one acknowledged and one deleted entry as a failure.

Do not attach a second consumer group to the same command stream: post-settlement
deletion would remove entries before that group necessarily consumes them. A
second group requires a separate stream or a future multi-group retention
protocol.

These lifecycle rules do not solve the separate pre-decode RESP allocation
bound. The production `serve` composition stays fail-closed until the selected
Redis client can enforce that bound before allocating a complete bulk reply.

Atomic deletion bounds retention only for settled entries. It does not bound
the command backlog while workers or control dependencies are unavailable.
Production activation still needs a non-dropping capacity admission gate that
rejects new work before Redis is overloaded. Do not use `MAXLEN` trimming for
this purpose: trimming may silently remove an unconsumed or pending command
before durable settlement.
