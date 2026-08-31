"""Comparing two ranked lists without asserting an implementation detail.

Both engines break score ties by whatever their storage order happens to be —
sqlite-vec by rowid, PostgreSQL by whatever the scan returns — and neither
order is a contract. Nine of the twenty vectors in the sample corpus are
mutually orthogonal to at least one query, so several queries produce a run of
identical distances; demanding a byte-identical ``ORDER BY`` there would assert
storage layout, not retrieval parity, and would be flaky besides.

So: scores must agree elementwise within tolerance, and the *order* must agree
**up to ties**. Members of a tie group may be permuted; a member crossing out
of its group is a real ranking change and fails.

Float32 is the reason for the tolerance rather than exact equality. sqlite-vec
stores float32 and pgvector stores float32, but they accumulate the L2 sum in
different orders, so distances agree to about 1e-7.
"""

from __future__ import annotations

from typing import Sequence


def tie_groups(scores: Sequence[float], tolerance: float) -> list[tuple[int, int]]:
    """Split a sorted score list into ``[start, end)`` runs of equal scores."""
    groups: list[tuple[int, int]] = []
    start = 0
    for index in range(1, len(scores) + 1):
        if index == len(scores) or abs(scores[index] - scores[start]) > tolerance:
            groups.append((start, index))
            start = index
    return groups


def assert_rankings_agree(
    actual: Sequence,
    expected_ids: Sequence[str],
    expected_scores: Sequence[float],
    *,
    score_key: str,
    tolerance: float,
    label: str = "",
) -> None:
    """Assert two ranked lists are the same ranking, ties permitted."""
    prefix = f"{label}: " if label else ""

    actual_ids = [hit.node_id for hit in actual]
    assert actual_ids == list(actual_ids), "internal"
    assert len(actual) == len(expected_ids), (
        f"{prefix}length differs: {len(actual)} vs {len(expected_ids)}\n"
        f"  actual:   {actual_ids}\n"
        f"  expected: {list(expected_ids)}"
    )
    assert set(actual_ids) == set(expected_ids), (
        f"{prefix}different documents were retrieved\n"
        f"  only in actual:   {sorted(set(actual_ids) - set(expected_ids))}\n"
        f"  only in expected: {sorted(set(expected_ids) - set(actual_ids))}"
    )

    actual_scores = [hit.scores[score_key] for hit in actual]
    for position, (got, want) in enumerate(zip(actual_scores, expected_scores)):
        assert abs(got - want) <= tolerance, (
            f"{prefix}{score_key} differs at position {position}: "
            f"{got!r} vs {want!r} (tolerance {tolerance})"
        )

    for start, end in tie_groups(list(expected_scores), tolerance):
        if end - start == 1:
            assert actual_ids[start] == expected_ids[start], (
                f"{prefix}position {start} differs: "
                f"{actual_ids[start]!r} vs {expected_ids[start]!r} — "
                f"this is not a tie, so it is a ranking change"
            )
            continue
        assert set(actual_ids[start:end]) == set(expected_ids[start:end]), (
            f"{prefix}a document moved across the tie group at "
            f"[{start}:{end}] (score ~{expected_scores[start]!r})\n"
            f"  actual:   {actual_ids[start:end]}\n"
            f"  expected: {list(expected_ids[start:end])}"
        )


def assert_ordering_agrees(
    actual: Sequence,
    expected_ids: Sequence[str],
    expected_scores: Sequence[float],
    *,
    tolerance: float,
    label: str = "",
) -> None:
    """Assert two rankings order the same documents the same way, ignoring scores.

    For the FTS branch the score *values* cannot match — PostgreSQL has neither
    FTS5's tokenizer nor its ``bm25()`` — so only the ordering is comparable.
    Tie groups are still defined by the *recorded* scores: where the legacy
    engine put two documents within ``tolerance`` of each other, its own order
    between them carries no information and neither can a port's.

    That is not a loophole. It is what makes a query like ``note`` honest:
    FTS5 clamps the idf of a term appearing in 13 of 20 documents to 1e-6, so
    its whole result block spans 2.7e-7 and its internal order is an artefact
    of length normalisation, not relevance. Queries with genuinely separated
    scores are the ones that carry the evidence.
    """
    prefix = f"{label}: " if label else ""
    actual_ids = [hit.node_id for hit in actual]

    assert set(actual_ids) == set(expected_ids), (
        f"{prefix}different documents were retrieved\n"
        f"  only in actual:   {sorted(set(actual_ids) - set(expected_ids))}\n"
        f"  only in expected: {sorted(set(expected_ids) - set(actual_ids))}"
    )

    for start, end in tie_groups(list(expected_scores), tolerance):
        assert set(actual_ids[start:end]) == set(expected_ids[start:end]), (
            f"{prefix}documents crossed a ranking boundary at [{start}:{end}]\n"
            f"  actual:   {actual_ids[start:end]}\n"
            f"  expected: {list(expected_ids[start:end])}\n"
            f"  expected scores in this group: {list(expected_scores[start:end])}"
        )


def discordant_pairs(actual_ids: Sequence[str], expected_ids: Sequence[str]) -> int:
    """Count pairs ordered one way in ``expected`` and the other in ``actual``."""
    position = {node_id: index for index, node_id in enumerate(actual_ids)}
    count = 0
    for i in range(len(expected_ids)):
        for j in range(i + 1, len(expected_ids)):
            left, right = expected_ids[i], expected_ids[j]
            if left in position and right in position and position[left] > position[right]:
                count += 1
    return count
