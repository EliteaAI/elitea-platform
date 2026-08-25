"""The durable half of the quarantine: it must outlive the process."""

from __future__ import annotations

import asyncio

import pytest

from elitea_worker.execution.errors import DependencyUnavailable, InvalidInput
from elitea_worker.execution.quarantine import (
    CompositeQuarantineStore,
    FileQuarantineStore,
)
from elitea_worker.transport.redis_quarantine import (
    SharedQuarantineStore,
    quarantine_key,
)


def test_a_recorded_entry_survives_a_new_store_over_the_same_file(tmp_path) -> None:
    """The whole point: a SECOND store instance sees the first one's decision.

    Two instances over one path is what a restart is. Asserting only that `add`
    returned True would pass even if nothing were written.
    """

    async def run() -> None:
        path = tmp_path / "quarantine.v1"
        first = FileQuarantineStore(path)
        assert await first.load() == frozenset()
        assert await first.add("1-0", reason_code="AUTHORIZATION_FAILED") is True

        # A new object with no shared memory — the file is the only channel.
        second = FileQuarantineStore(path)
        assert await second.load() == frozenset({"1-0"})

    asyncio.run(run())


def test_the_reason_is_written_for_a_reader_but_not_needed_to_load(tmp_path) -> None:
    async def run() -> None:
        path = tmp_path / "quarantine.v1"
        store = FileQuarantineStore(path)
        await store.add("2-0", reason_code="AUTHORIZATION_FAILED")

        written = path.read_text(encoding="utf-8").strip()
        assert written == "2-0\tAUTHORIZATION_FAILED"
        assert await FileQuarantineStore(path).load() == frozenset({"2-0"})

    asyncio.run(run())


def test_recording_the_same_entry_twice_is_idempotent(tmp_path) -> None:
    async def run() -> None:
        path = tmp_path / "quarantine.v1"
        store = FileQuarantineStore(path)
        assert await store.add("3-0", reason_code="X") is True
        assert await store.add("3-0", reason_code="X") is True
        assert len(path.read_text(encoding="utf-8").splitlines()) == 1

    asyncio.run(run())


def test_the_cap_refuses_rather_than_growing(tmp_path) -> None:
    """Past the cap `add` answers False, so the caller can say so."""

    async def run() -> None:
        store = FileQuarantineStore(tmp_path / "quarantine.v1", cap=2)
        assert await store.add("1-0", reason_code="X") is True
        assert await store.add("2-0", reason_code="X") is True
        assert await store.add("3-0", reason_code="X") is False
        # An already-recorded entry is still accepted at the cap.
        assert await store.add("1-0", reason_code="X") is True

    asyncio.run(run())


def test_a_missing_file_is_an_empty_record(tmp_path) -> None:
    async def run() -> None:
        store = FileQuarantineStore(tmp_path / "nothing-here" / "quarantine.v1")
        assert await store.load() == frozenset()

    asyncio.run(run())


def test_a_damaged_line_is_skipped_counted_and_the_rest_still_load(tmp_path) -> None:
    """One bad byte must not cost the whole record, nor pass unmentioned."""

    async def run() -> None:
        path = tmp_path / "quarantine.v1"
        path.write_text(
            "1-0\tAUTHORIZATION_FAILED\n"
            "\n"
            f"{'x' * 200}\tTOO_LONG\n"
            "2-0\tAUTHORIZATION_FAILED\n",
            encoding="utf-8",
        )
        store = FileQuarantineStore(path)
        assert await store.load() == frozenset({"1-0", "2-0"})
        assert store.malformed_lines == 1

    asyncio.run(run())


@pytest.mark.parametrize("entry_id", ["", "a\tb", "x" * 200, "a\nb", "1-0 2-0", "1-0\r"])
def test_a_malformed_entry_id_is_refused_on_write(tmp_path, entry_id: str) -> None:
    async def run() -> None:
        store = FileQuarantineStore(tmp_path / "quarantine.v1")
        with pytest.raises(InvalidInput):
            await store.add(entry_id, reason_code="X")

    asyncio.run(run())


def test_a_reason_cannot_forge_a_second_field(tmp_path) -> None:
    """The reason is untrusted for FORMAT purposes: it must not inject a field
    separator or a newline that would turn one record into two."""

    async def run() -> None:
        path = tmp_path / "quarantine.v1"
        store = FileQuarantineStore(path)
        await store.add("4-0", reason_code="A\tB\nC")

        lines = path.read_text(encoding="utf-8").splitlines()
        assert len(lines) == 1
        assert lines[0].split("\t")[0] == "4-0"
        assert await FileQuarantineStore(path).load() == frozenset({"4-0"})

    asyncio.run(run())


# ── the shared tier, and the composite over both ────────────────────────────


class FakeRedisQuarantineClient:
    """Mimics the Lua contract: 1 stored/already-there, 0 refused by the cap."""

    def __init__(self, *, fail: bool = False) -> None:
        self.hashes: dict[str, dict[str, str]] = {}
        self.fail = fail
        self.expires: list[tuple[str, int]] = []

    async def quarantine_entry(
        self,
        *,
        key: str,
        entry_id: str,
        cap: int,
        ttl_seconds: int,
        recorded_reason: str,
    ):
        if self.fail:
            raise RuntimeError("redis is gone")
        recorded = self.hashes.setdefault(key, {})
        if entry_id not in recorded:
            if len(recorded) >= cap:
                return 0
            recorded[entry_id] = recorded_reason
        self.expires.append((key, ttl_seconds))
        return 1

    async def quarantined_entries(self, *, key: str):
        if self.fail:
            raise RuntimeError("redis is gone")
        return [entry.encode("ascii") for entry in self.hashes.get(key, {})]

    async def clear_quarantined_entry(self, *, key: str, entry_id: str):
        self.hashes.get(key, {}).pop(entry_id, None)
        return 1


def _shared(client, **kwargs) -> SharedQuarantineStore:
    return SharedQuarantineStore(
        client,
        stream="commands.v1.agent.execute.agent.shared.1.0",
        group="elitea-agent-worker-v1",
        **kwargs,
    )


def test_the_shared_key_is_scoped_to_stream_and_group() -> None:
    """Two groups must not share one decision, and the key must stay inside the
    pattern the runtime ACL grants (`…:quarantine:<stream>:*`)."""
    stream = "commands.v1.agent.execute.agent.shared.1.0"
    first = quarantine_key(stream=stream, group="group-a")
    second = quarantine_key(stream=stream, group="group-b")

    assert first != second
    assert first.startswith(f"elitea:runtime:v1:quarantine:{stream}:")


def test_a_second_replica_sees_the_first_replicas_refusal() -> None:
    """The point of the shared tier: two stores, no shared memory, one client."""

    async def run() -> None:
        client = FakeRedisQuarantineClient()
        replica_one = _shared(client)
        replica_two = _shared(client)

        assert await replica_two.load() == frozenset()
        assert await replica_one.add("1-0", reason_code="AUTHORIZATION_FAILED") is True
        assert await replica_two.load() == frozenset({"1-0"})

    asyncio.run(run())


def test_the_shared_cap_refuses_rather_than_growing() -> None:
    async def run() -> None:
        store = _shared(FakeRedisQuarantineClient(), cap=2)
        assert await store.add("1-0", reason_code="X") is True
        assert await store.add("2-0", reason_code="X") is True
        assert await store.add("3-0", reason_code="X") is False
        assert await store.add("1-0", reason_code="X") is True

    asyncio.run(run())


def test_the_composite_treats_a_record_in_either_tier_as_a_refusal(tmp_path) -> None:
    """A local-only record still counts; so does a shared-only one."""

    async def run() -> None:
        client = FakeRedisQuarantineClient()
        local = FileQuarantineStore(tmp_path / "quarantine.v1")
        await local.add("local-1", reason_code="X")
        await _shared(client).add("shared-1", reason_code="X")

        composite = CompositeQuarantineStore(shared=_shared(client), local=local)
        assert await composite.load() == frozenset({"local-1", "shared-1"})

    asyncio.run(run())


def test_the_composite_writes_through_to_both_tiers(tmp_path) -> None:
    async def run() -> None:
        client = FakeRedisQuarantineClient()
        local = FileQuarantineStore(tmp_path / "quarantine.v1")
        composite = CompositeQuarantineStore(shared=_shared(client), local=local)

        assert await composite.add("7-0", reason_code="AUTHORIZATION_FAILED") is True
        assert not composite.shared_failed and not composite.local_failed
        # Independently observable in each tier.
        assert await _shared(client).load() == frozenset({"7-0"})
        assert await FileQuarantineStore(local.path).load() == frozenset({"7-0"})

    asyncio.run(run())


def test_a_shared_outage_keeps_the_local_record_and_says_which_tier_failed(
    tmp_path,
) -> None:
    """The regression this guards: an unreachable Redis must not cost the
    durability the local tier already provided."""

    async def run() -> None:
        path = tmp_path / "quarantine.v1"
        seeded = FileQuarantineStore(path)
        await seeded.add("8-0", reason_code="X")

        composite = CompositeQuarantineStore(
            shared=_shared(FakeRedisQuarantineClient(fail=True)),
            local=FileQuarantineStore(path),
        )
        assert await composite.load() == frozenset({"8-0"})
        assert composite.shared_failed is True
        assert composite.local_failed is False

        # A write still succeeds, locally, and reports the degraded tier.
        assert await composite.add("9-0", reason_code="X") is True
        assert composite.shared_failed is True

    asyncio.run(run())


def test_the_composite_refuses_when_neither_tier_can_be_read(tmp_path) -> None:
    async def run() -> None:
        class BrokenLocal(FileQuarantineStore):
            async def load(self) -> frozenset[str]:
                raise RuntimeError("disk is gone")

        composite = CompositeQuarantineStore(
            shared=_shared(FakeRedisQuarantineClient(fail=True)),
            local=BrokenLocal(tmp_path / "quarantine.v1"),
        )
        with pytest.raises(DependencyUnavailable):
            await composite.load()

    asyncio.run(run())


@pytest.mark.parametrize("entry_id", ["1-0 2-0", "a b", "", "x" * 200, "1-0\t2-0"])
def test_the_shared_tier_refuses_a_malformed_entry_id(entry_id: str) -> None:
    """A list of ids that a shell failed to split must not become ONE entry.

    Observed: `seed.py $IDS` under a shell that does not word-split passed all
    four ids as one argument, and it was accepted — every character was
    printable ASCII, so nothing objected.
    """

    async def run() -> None:
        store = _shared(FakeRedisQuarantineClient())
        with pytest.raises(InvalidInput):
            await store.add(entry_id, reason_code="X")

    asyncio.run(run())


# ── backfill: adoption must also become durable ─────────────────────────────


def test_adopting_from_shared_writes_the_entries_into_the_local_record(
    tmp_path,
) -> None:
    """The gap this closes: adoption alone lived only in the process.

    The assertion that matters is the LAST one — after the backfill, a shared
    tier that has gone away no longer costs the decision. Asserting only that
    the file grew would pass even if the rows were unreadable.
    """

    async def run() -> None:
        client = FakeRedisQuarantineClient()
        await _shared(client).add("group-1", reason_code="AUTHORIZATION_FAILED")
        path = tmp_path / "quarantine.v1"

        composite = CompositeQuarantineStore(
            shared=_shared(client), local=FileQuarantineStore(path)
        )
        assert await composite.load() == frozenset({"group-1"})
        assert composite.backfilled == 1
        assert composite.backfill_refused == 0

        # The row is marked as adopted, not as a refusal this replica made.
        assert path.read_text(encoding="utf-8").strip() == "group-1\tADOPTED_FROM_SHARED"

        # THE POINT: Redis is gone now, and the decision still holds.
        offline = CompositeQuarantineStore(
            shared=_shared(FakeRedisQuarantineClient(fail=True)),
            local=FileQuarantineStore(path),
        )
        assert await offline.load() == frozenset({"group-1"})
        assert offline.shared_failed is True

    asyncio.run(run())


def test_backfill_does_not_duplicate_rows_across_repeated_loads(tmp_path) -> None:
    """A worker restarts often; the file must not grow by the whole shared set
    every time."""

    async def run() -> None:
        client = FakeRedisQuarantineClient()
        await _shared(client).add("group-1", reason_code="X")
        path = tmp_path / "quarantine.v1"

        first = CompositeQuarantineStore(
            shared=_shared(client), local=FileQuarantineStore(path)
        )
        await first.load()
        second = CompositeQuarantineStore(
            shared=_shared(client), local=FileQuarantineStore(path)
        )
        await second.load()

        assert second.backfilled == 0, "the second load re-copied an existing row"
        assert len(path.read_text(encoding="utf-8").splitlines()) == 1

    asyncio.run(run())


def test_a_locally_refused_row_keeps_its_own_reason(tmp_path) -> None:
    """Backfill must not overwrite the reason on an entry this replica refused."""

    async def run() -> None:
        client = FakeRedisQuarantineClient()
        path = tmp_path / "quarantine.v1"
        local = FileQuarantineStore(path)
        await local.add("mine", reason_code="AUTHORIZATION_FAILED")
        await _shared(client).add("mine", reason_code="AUTHORIZATION_FAILED")

        composite = CompositeQuarantineStore(
            shared=_shared(client), local=FileQuarantineStore(path)
        )
        await composite.load()

        assert composite.backfilled == 0
        assert path.read_text(encoding="utf-8").strip() == "mine\tAUTHORIZATION_FAILED"

    asyncio.run(run())


def test_backfill_is_skipped_when_the_local_record_could_not_be_read(
    tmp_path,
) -> None:
    """Appending against an unknown file duplicates rows, so it does not."""

    async def run() -> None:
        class UnreadableLocal(FileQuarantineStore):
            async def load(self) -> frozenset[str]:
                raise RuntimeError("disk is gone")

        client = FakeRedisQuarantineClient()
        await _shared(client).add("group-1", reason_code="X")
        path = tmp_path / "quarantine.v1"

        composite = CompositeQuarantineStore(
            shared=_shared(client), local=UnreadableLocal(path)
        )
        assert await composite.load() == frozenset({"group-1"})
        assert composite.local_failed is True
        assert composite.backfilled == 0
        assert not path.exists()

    asyncio.run(run())


def test_a_full_local_record_reports_an_incomplete_backfill(tmp_path) -> None:
    """Past the local cap the group's decision is honoured now and lost at the
    next restart — which has to be said, not silently accepted."""

    async def run() -> None:
        client = FakeRedisQuarantineClient()
        for index in range(4):
            await _shared(client).add(f"group-{index}", reason_code="X")

        composite = CompositeQuarantineStore(
            shared=_shared(client),
            local=FileQuarantineStore(tmp_path / "quarantine.v1", cap=2),
        )
        adopted = await composite.load()

        assert len(adopted) == 4, "every shared entry is still honoured in memory"
        assert composite.backfilled == 2
        assert composite.backfill_refused == 2

    asyncio.run(run())
