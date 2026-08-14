# Redis command delivery source mapping

Redis is Elitea's durable command-delivery transport. It is not an ADK session,
memory, graph-state or checkpoint backend. Main remains the command producer
and durable business-state authority; Redis Pending Entries List ownership is
transport liveness only.

## Source-to-Rust ledger

| Source evidence | Required behavior | Rust owner | Proof / status |
| --- | --- | --- | --- |
| Python `transport/redis_asyncio.py::RedisAsyncioControlClient.connect` and `config.py::RuntimeDeployConfig.validate_redis_url` | Canonical `rediss://acl-user@host:port/0`, no URL password/query/fragment, exact private CA, hostname verification, client certificate/key, RESP2 | `src/transport/redis_streams.rs::{RedisStreamsConfig,RedisTlsMaterial,validate_endpoint,build_tls_config,connect_redis}` | Implemented. Rust explicitly selects only TLS 1.3 and does not load system roots. Source secret buffers zeroize after construction; the connected redis-rs/Rustls clients retain only their process-lifetime connection state. Real mTLS/ACL component proof remains |
| Python `RedisAsyncioControlClient.connect` and `serve.py::serve` | A blocking read must not starve control traffic; connection/command attempts and queues are bounded | `RedisStreamsClient::{intake,control,intake_gate,control_gate,failed}` | Implemented as exactly one dedicated blocking-intake connection plus one bounded control connection. redis-rs receives worker-owned TCP/Rustls streams and has no connection manager or reconnect policy. Connection/control timeouts are whole milliseconds capped at 300 seconds; intake response time is derived from the configured block and capped at 31 seconds. Bounded owner tasks retain capacity through protocol response/timeout even if the caller is cancelled. Any command or post-decode failure latches the whole two-connection client closed, preventing a timed-out in-flight correlation from being followed by more commands; the outer serve loop must replace that client and owns reconnect/backoff |
| Python `serve.py::{_wait_for_redis,WorkerServeLoop._intake_loop}` plus redis-py's internal pool reconnect | A failed transport generation is replaced explicitly without replaying an unknown-effect read, reclaim, heartbeat or retirement; concurrent failures create one replacement and a late old-generation failure cannot evict it | `src/transport/redis_generation.rs::{RedisStreamsConnection,RedisStreamsConnector,RedisStreamsHandle}` | Implemented as a crate-private generation owner. Normal operations clone the exact current connection without holding its state lock across I/O. Retryable failures remove only that generation; reconnect is an explicit later action, serialized under one cancellation-safe owner. Exact retirement always resolves the current generation and invalidates a failed one. Production TLS-material reload, stop-aware backoff and serve-loop ownership remain the next composition boundary |
| Python `transport/redis_commands.py::RedisCommandConsumer.read` | `XREADGROUP GROUP <group> <consumer> COUNT 1..64 BLOCK <positive and capped> STREAMS <stream> >`, never `NOACK`, never create a group. Deployment block configuration is 100..30000 ms, while the fair serve loop may shorten one read toward 1 ms before reclaim | `RedisStreamsClient::read_new` | Implemented with a single outstanding blocking read, configured ceilings and strict RESP2 array decoding |
| Python `RedisCommandConsumer::{reclaim,reclaim_page}` | Redis 7 `XAUTOCLAIM`, bounded count and cursor, accept and validate optional deleted IDs | `RedisStreamsClient::reclaim_page`, `RedisReclaimPage` | Implemented. Entry bytes are decoded through the same strict delivery boundary as new intake; Rust also refuses reclaim earlier than twice Main's 30-second claim lease |
| Python `RedisCommandConsumer::heartbeat_pending` and `_HEARTBEAT_OWNED_PENDING_SCRIPT` | Refresh idle time only when an exact ID is still pending under this consumer; at most 64 unique IDs | `RedisStreamsClient::heartbeat_owned_pending`, private `HEARTBEAT_OWNED_PENDING_SCRIPT` | Implemented. Returned IDs must be a unique subset of the request. This grants no Go execution claim or output authority |
| Python `RedisCommandConsumer::_decode_entry`; worker command codec | Exactly one binary `signed_envelope`, preserve bytes and duplicate field order until rejection; 64 KiB entry / 48 KiB field deployed profile | `redis_commands.rs::RedisCommandDelivery::decode`; `redis_streams.rs::{decode_read_response,decode_reclaim_response,decode_delivery}` | Implemented post-RESP bounds and mutation tests. redis-rs has already allocated the complete RESP frame, so hostile-server pre-allocation bounds require a later parser seam; dedicated TLS/ACL Redis plus Main producer admission are mandatory |
| Python `_RETIRE_DELIVERY_SCRIPT`, `ack_after_settlement`; Main `redisdispatch::deliveryIndexKey` | Verify stable delivery mapping, exact stream entry/field/bytes and current PEL owner; then atomically `XACK`, `XDEL`, `HDEL`. Accept only `(1,1,1)` or all-absent replay `(2,0,0)` | `redis_commands.rs::RedisCommandRetirer`; `redis_streams.rs::{RedisRetirementClient impl,RETIRE_DELIVERY_SCRIPT}` | Implemented. The transport rechecks its configured stream/group/consumer. No standalone ACK/delete/Lua method exists; only a consumed exact signed-command settlement authority reaches this path |
| Main `transport/redisdispatch/stream_capacity.go` and `producer.go` | Do not trim unsettled commands; keep stream and delivery-index capacity/consistency at producer admission; use one logical primary | Main-owned, intentionally not duplicated in worker | Existing Go source is authoritative. Rust neither creates groups nor publishes/trims commands. Cutover requires an empty stream/PEL/index and one primary, plus a cross-process recovery test |
| Python `serve.py::WorkerServeLoop` | Fair new/reclaim intake, bounded queue plus active jobs, heartbeat both sets, reclaim after loss, stop admission then drain | Planned Rust serve-loop owner over `RedisStreamsHandle`, `AgentInvocationSupervisor` and the shared app/ad-hoc delivery router | Not yet implemented. The replaceable Redis generation boundary is ready; the scheduler, production TLS-material connector and real Redis 7 failure/reclaim proof remain. Redis does not belong inside ADK or the event projector |

## Failure and logging policy

`RedisStreamsError` exposes stable low-cardinality codes, retryability and a
safe redis-rs error category. The server text is discarded because Redis errors
may echo command or deployment data. The lifecycle owner records the stable
code once with trusted execution/consumer identifiers; the low-level transport
does not log payloads, signed envelopes, credentials, URLs or certificates.

Authentication, TLS and configuration failures are not reconnect loops.
Dependency loss and timeout are retryable only at an outer
operation boundary that understands whether an effect may already have
happened. In particular, the restricted client never internally repeats an
unknown-effect retirement script. The first command/response ambiguity latches
both connections closed; all later operations fail before enqueue until the
outer owner drops and replaces the client. A decoded entry, field or response
that exceeds a fixed bound is nonretryable poison input, not backpressure.
