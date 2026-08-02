# `elitea-scheduler` ownership disposition

This process is not the owner of product schedule occurrences.

The current `internal/scheduler` implementation polls `centry.schedule`, takes a
Redis tick lock, and publishes legacy Pylon/Arbiter RPC payloads. It has no
PostgreSQL occurrence ledger, lease epoch, or fence. Running it for the same job
as the `elitea-main` scheduling kernel would create two clocks and is forbidden.

For the focused indexing transition:

- the current `index_scheduling` row is disabled in the hybrid deployment;
- `elitea-main` registers `index.schedule.scan.v1` on its one-minute cadence;
- PostgreSQL `elitea_runtime.scheduled_job_cursors` and
  `elitea_runtime.scheduled_occurrences` own planning, takeover, and completion;
- pipeline and other current `centry.schedule` rows remain owned by the current
  Pylon scheduling plugin until each receives a typed Go disposition; and
- the legacy Redis/Pylon scheduler must not be enabled as a fallback for a job
  registered in `elitea-main`.

The price-catalog sync and budget write-back consumers currently sharing this
binary are independent lifecycle responsibilities. They require an explicit
relocation or retained-service decision before this image can be deleted. This
note does not claim that work is complete.
