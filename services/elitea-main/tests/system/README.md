# Production runtime cross-process system test

`TestProductionRuntimeCrossProcessSystem` starts real PostgreSQL 16 and two
Redis 7 containers, then independently starts the production `elitea-main`
binary and four `elitea-worker serve` processes. Three workers independently
prove fail-closed command-signature, durable workload-identity binding, and
mTLS trust-root enforcement: each leaves the command unclaimed and
unacknowledged. The authorized worker then reclaims the same pending reference
and completes the public submit, Redis reference delivery, mTLS gRPC claim,
HTTP/2 content fetch, SDK business handler, mTLS gRPC output/settlement, atomic
stable-delivery-bound `XACK` + `XDEL` + delivery-index `HDEL`, and authorized
SSE replay.

Against the same TLS/ACL broker, the test also verifies that worker credentials
cannot `XADD`, `HSET`, or `PUBLISH`, while producer credentials cannot
`XREADGROUP`, `XACK`, or `XDEL`. Both roles are restricted to the command
stream and its delivery-index key.

Run it explicitly; the ordinary unit/component suites do not start Docker:

```bash
ELITEA_RUNTIME_SYSTEM_TEST=1 \
ELITEA_SYSTEM_PYTHON=/absolute/path/to/python3.12 \
go test -count=1 -v ./services/elitea-main/tests/system \
  -run '^TestProductionRuntimeCrossProcessSystem$'
```

The selected Python environment must contain the worker dependencies, notably
the pinned SDK, `redis`, `h2`, `grpcio`, `httpx`, `pydantic`, and
`cryptography`. `ELITEA_SYSTEM_PYTHONPATH` may point at an additional local
dependency directory.

`ELITEA_SYSTEM_SDK_PATH` may point at the exact admitted Elitea SDK root. Use
it when a sibling `elitea-sdk` checkout exists but has advanced beyond the
worker's pinned revision; the worker intentionally fails closed on a package-
tree digest mismatch.

This is system/end-to-end evidence for the small credential-free configuration
validation slice. It is not a load, soak, penetration, failover, certificate
rotation, or production-scale issue #5681 test. The current input-content
profile is intentionally capped at 256 KiB; large file/image streaming needs
its artifact path before that broader scenario can be claimed closed by a
system test.
