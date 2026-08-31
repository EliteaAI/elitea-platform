"""Retrieval parity: the gate on the SQLite/FAISS → PostgreSQL storage port.

ADR-0022's Consequences name this the largest share of port risk, and require
that "any ranking drift must be shown against them [the P0 fixtures], not
assumed away". So each branch is asserted at the strength it can actually
hold, and the one branch that cannot be exact says so in a report instead of
being quietly relaxed:

===========  =====================================================
branch       assertion
===========  =====================================================
dense        exact — same order, same L2 distances
bm25         exact — same order, same scores
fts          same match set; ordering compared and any divergence
             reported (Snowball ≠ Porter1, ts_rank ≠ FTS5 bm25())
fused        recomputed from the component rankings; exact when the
             component orderings agree
===========  =====================================================

Both backends are live here. The legacy one is the reference implementation,
so a difference is attributable to the port rather than to a stale fixture.
"""

from __future__ import annotations

import math

import pytest

from elitea_deepwiki.storage.base import rrf_fuse

from .conftest import load, query_fixtures
from .ranking import (
    assert_ordering_agrees,
    assert_rankings_agree,
    discordant_pairs,
    tie_groups,
)

QUERIES = query_fixtures()
QUERY_IDS = [slug for slug, _ in QUERIES]

#: Absolute tolerance for a score recorded at nine decimal places.
TOLERANCE = 1e-6


def ids(hits) -> list[str]:
    return [hit.node_id for hit in hits]


# ---------------------------------------------------------------------------
# the reference backend still reproduces the fixtures
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("slug,fixture", QUERIES, ids=QUERY_IDS)
def test_reference_backend_reproduces_the_recorded_rankings(
    sqlite_backend, slug: str, fixture: dict
):
    """The control.

    If this fails, the fixtures and the legacy code have drifted apart and no
    conclusion about the PostgreSQL backend is trustworthy — so it runs first
    and is asserted exactly.
    """
    parameters = fixture["parameters"]
    query = fixture["query"]
    embedding = fixture["query_embedding"]
    recorded = fixture["rankings"]

    for branch, hits, score_key in (
        ("fts", sqlite_backend.search_fts(query, limit=parameters["fts_pool"]), "fts_rank"),
        ("dense", sqlite_backend.search_dense(embedding, k=parameters["vec_pool"]), "vec_distance"),
        ("bm25", sqlite_backend.search_bm25(query, k=100), "bm25_score"),
    ):
        rows = recorded[branch]["results"]
        assert_rankings_agree(
            hits,
            [row["node_id"] for row in rows],
            [row[score_key] for row in rows],
            score_key=score_key,
            tolerance=TOLERANCE,
            label=f"reference/{branch}/{slug}",
        )


# ---------------------------------------------------------------------------
# dense — exact
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("slug,fixture", QUERIES, ids=QUERY_IDS)
def test_dense_ranking_is_exact(postgres_backend, slug: str, fixture: dict):
    """pgvector `<->` is L2, the same metric sqlite-vec's KNN uses.

    Exact because the search is a sequential scan: migration 0001 creates no
    HNSW index, so no approximation is in play. When HNSW arrives, this test
    keeps its meaning only if it keeps running against exact scan — the recall
    of the approximate index is a *different* measurement.
    """
    recorded = fixture["rankings"]["dense"]["results"]
    hits = postgres_backend.search_dense(
        fixture["query_embedding"], k=fixture["parameters"]["vec_pool"]
    )

    assert_rankings_agree(
        hits,
        [row["node_id"] for row in recorded],
        [row["vec_distance"] for row in recorded],
        score_key="vec_distance",
        tolerance=TOLERANCE,
        label=f"dense/{slug}",
    )


# ---------------------------------------------------------------------------
# bm25 — exact
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("slug,fixture", QUERIES, ids=QUERY_IDS)
def test_bm25_ranking_is_exact(postgres_backend, slug: str, fixture: dict):
    """The term-statistics port reproduces the legacy scores, not just the order.

    This is the branch ADR-0022 flagged as needing re-expression. Exactness is
    achievable here — the tokenizer is a whitespace split and the formula is
    written down — so it is asserted rather than approximated.
    """
    recorded = fixture["rankings"]["bm25"]["results"]
    hits = postgres_backend.search_bm25(fixture["query"], k=len(recorded) or 1)

    assert_rankings_agree(
        hits,
        [row["node_id"] for row in recorded],
        [row["bm25_score"] for row in recorded],
        score_key="bm25_score",
        tolerance=TOLERANCE,
        label=f"bm25/{slug}",
    )


def test_bm25_statistics_match_the_recorded_index(postgres_backend):
    """Corpus-level statistics, not just per-query scores.

    avgdl and doc_count are the inputs every score depends on; comparing them
    directly means a coincidental per-query agreement cannot hide a wrong
    corpus.
    """
    recorded = load("index_stats.json")["stats"]["bm25"]
    branch = postgres_backend.stats()["bm25_branches"]["bm25"]

    assert branch["doc_count"] == recorded["doc_count"]
    assert branch["avgdl"] == pytest.approx(recorded["avgdl"], abs=1e-9)
    assert branch["k1"] == recorded["k1"]
    assert branch["b"] == recorded["b"]


# ---------------------------------------------------------------------------
# fts — match set exact, ordering measured
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("slug,fixture", QUERIES, ids=QUERY_IDS)
def test_fts_match_set_is_preserved(postgres_backend, slug: str, fixture: dict):
    """Which rows match is the contract; what score they get is not.

    `plainto_tsquery` ANDs its lexemes, exactly as FTS5 ANDs bare terms in a
    MATCH expression. If this drifts, the fused ranking's input set changes and
    every downstream ranking changes with it — so the match set is asserted
    exactly even though the scores are not.
    """
    recorded = {row["node_id"] for row in fixture["rankings"]["fts"]["results"]}
    hits = postgres_backend.search_fts(
        fixture["query"], limit=fixture["parameters"]["fts_pool"]
    )
    assert {hit.node_id for hit in hits} == recorded


@pytest.mark.parametrize("slug,fixture", QUERIES, ids=QUERY_IDS)
def test_fts_ordering_is_preserved(postgres_backend, slug: str, fixture: dict):
    """The ordering, which is what the fused ranking consumes.

    Scores are not compared — PostgreSQL has neither FTS5's tokenizer nor its
    `bm25()`, so the magnitudes are expected to differ and asserting them would
    only pin an accident. What must hold is the order, and it is compared with
    the legacy scores defining the tie groups: where FTS5 itself separated two
    documents by more than the fixture's precision, the port has to keep them
    in that order.
    """
    recorded = fixture["rankings"]["fts"]["results"]
    hits = postgres_backend.search_fts(
        fixture["query"], limit=fixture["parameters"]["fts_pool"]
    )
    assert_ordering_agrees(
        hits,
        [row["node_id"] for row in recorded],
        [row["fts_rank"] for row in recorded],
        tolerance=TOLERANCE,
        label=f"fts/{slug}",
    )


@pytest.mark.parametrize("slug,fixture", QUERIES, ids=QUERY_IDS)
def test_fts_scores_keep_the_legacy_sign_and_normalisation(
    postgres_backend, slug: str, fixture: dict
):
    """The shape of the score, which everything downstream depends on."""
    hits = postgres_backend.search_fts(
        fixture["query"], limit=fixture["parameters"]["fts_pool"]
    )
    ranks = [hit.scores["fts_rank"] for hit in hits]

    # More negative is better, and the list is ordered by it.
    assert ranks == sorted(ranks)
    for hit in hits:
        assert hit.scores["fts_rank"] <= 0.0
        assert hit.scores["score_norm"] == pytest.approx(
            1.0 / (1.0 + math.exp(hit.scores["fts_rank"])), abs=1e-12
        )
        assert 0.0 <= hit.scores["score_norm"] <= 1.0


# ---------------------------------------------------------------------------
# fused
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("slug,fixture", QUERIES, ids=QUERY_IDS)
def test_fused_ranking_follows_from_the_component_rankings(
    postgres_backend, slug: str, fixture: dict
):
    """Fusion is arithmetic; parity of the fused list is parity of its inputs.

    Recomputing the fusion here from the backend's own component lists proves
    the backend's `search_hybrid` applies the frozen weighted RRF, separately
    from whether its components matched the legacy ones.
    """
    parameters = fixture["parameters"]
    fts = postgres_backend.search_fts(fixture["query"], limit=parameters["fts_pool"])
    dense = postgres_backend.search_dense(
        fixture["query_embedding"], k=parameters["vec_pool"]
    )
    expected = rrf_fuse(
        fts,
        dense,
        fts_weight=parameters["fts_weight"],
        vec_weight=parameters["vec_weight"],
        rrf_constant=parameters["rrf_constant"],
        limit=parameters["top_k"],
    )

    actual = postgres_backend.search_hybrid(
        fixture["query"],
        fixture["query_embedding"],
        limit=parameters["top_k"],
        fts_weight=parameters["fts_weight"],
        vec_weight=parameters["vec_weight"],
        fts_pool=parameters["fts_pool"],
        vec_pool=parameters["vec_pool"],
    )

    assert ids(actual) == ids(expected)
    for got, want in zip(actual, expected):
        assert got.scores["combined_score"] == pytest.approx(
            want.scores["combined_score"], abs=1e-12
        )


@pytest.mark.parametrize("slug,fixture", QUERIES, ids=QUERY_IDS)
def test_fused_ranking_matches_the_fixture_when_components_agree(
    postgres_backend, slug: str, fixture: dict
):
    """The end-to-end claim, conditioned on what it actually depends on.

    The fused list consumes FTS *positions*. When the PostgreSQL FTS ordering
    equals the recorded one, the fused ranking must equal the recorded one
    exactly — there is nothing else it could differ by. When the orderings
    differ, this test records that the precondition failed rather than passing
    vacuously; `test_fts_ordering_drift_report` quantifies it.
    """
    recorded = fixture["rankings"]
    parameters = fixture["parameters"]
    recorded_fts = [row["node_id"] for row in recorded["fts"]["results"]]
    actual_fts = ids(
        postgres_backend.search_fts(fixture["query"], limit=parameters["fts_pool"])
    )

    if actual_fts != recorded_fts:
        pytest.skip(
            f"FTS ordering differs for {slug!r} "
            f"(recorded {recorded_fts} vs postgres {actual_fts}); "
            "the fused comparison is not meaningful until that is closed — "
            "see test_fts_parity_report"
        )

    # RRF consumes POSITIONS. Where a component branch has tied scores, the
    # position each tied document gets is arbitrary in both engines, so the
    # fused ranking is genuinely undetermined and comparing it would assert
    # storage order. test_fused_ranking_is_undetermined_when_a_component_ties
    # pins that as a property; here it is simply out of scope.
    dense_scores = [row["vec_distance"] for row in recorded["dense"]["results"]]
    for start, end in tie_groups(dense_scores, TOLERANCE):
        if end - start > 1 and start < parameters["top_k"]:
            pytest.skip(
                f"{slug!r} has a dense tie group at [{start}:{end}] reaching "
                f"into the fused top-{parameters['top_k']}, so the fused order "
                "is not determined by the ranking"
            )

    hits = postgres_backend.search_hybrid(
        fixture["query"],
        fixture["query_embedding"],
        limit=fixture["parameters"]["top_k"],
        fts_pool=fixture["parameters"]["fts_pool"],
        vec_pool=fixture["parameters"]["vec_pool"],
    )
    rows = recorded["fused"]["results"]
    assert_rankings_agree(
        hits,
        [row["node_id"] for row in rows],
        [row["combined_score"] for row in rows],
        score_key="combined_score",
        tolerance=1e-9,
        label=f"fused/{slug}",
    )


def test_fused_ranking_is_undetermined_when_a_component_ties(postgres_backend):
    """A property of weighted RRF that the port inherits, pinned so it is known.

    RRF scores a document by its *position*, not its score:
    ``fts_weight/(k + pos) + vec_weight/(k + pos)``. Two documents with
    identical dense distances therefore receive different combined scores
    purely from which one the scan returned first — and the legacy engine had
    the same property, so this is inherited, not introduced.

    The sample corpus makes it easy to hit: its vectors are L2-normalised, so
    any two documents orthogonal to the query sit at exactly sqrt(2), and
    three of the eleven fixture queries have such a block inside the fused
    top-10. Any product decision to make the fused order deterministic (a
    stable secondary sort, say) is a *change* to ranking behaviour and needs
    its own fixtures — it cannot be slipped in as part of the storage port.
    """
    ranked_with_ties = []
    for slug, fixture in QUERIES:
        dense_scores = [
            row["vec_distance"] for row in fixture["rankings"]["dense"]["results"]
        ]
        groups = [
            (start, end)
            for start, end in tie_groups(dense_scores, TOLERANCE)
            if end - start > 1 and start < fixture["parameters"]["top_k"]
        ]
        if groups:
            ranked_with_ties.append((slug, groups))

    print("\nQueries whose fused order is undetermined by component ties:")
    for slug, groups in ranked_with_ties:
        print(f"  {slug:<26} dense tie groups in top-k: {groups}")

    assert ranked_with_ties, (
        "no fixture query exercises a component tie any more; either the "
        "corpus changed or this property stopped holding — check before "
        "deleting this test"
    )

    # Whatever order it picks, the backend must still apply the frozen fusion
    # to its own components. That is the invariant that survives ties.
    for slug, _groups in ranked_with_ties:
        fixture = dict(QUERIES)[slug]
        parameters = fixture["parameters"]
        fts = postgres_backend.search_fts(
            fixture["query"], limit=parameters["fts_pool"]
        )
        dense = postgres_backend.search_dense(
            fixture["query_embedding"], k=parameters["vec_pool"]
        )
        expected = rrf_fuse(
            fts,
            dense,
            fts_weight=parameters["fts_weight"],
            vec_weight=parameters["vec_weight"],
            rrf_constant=parameters["rrf_constant"],
            limit=parameters["top_k"],
        )
        actual = postgres_backend.search_hybrid(
            fixture["query"],
            fixture["query_embedding"],
            limit=parameters["top_k"],
            fts_pool=parameters["fts_pool"],
            vec_pool=parameters["vec_pool"],
        )
        assert ids(actual) == ids(expected), slug


# ---------------------------------------------------------------------------
# the drift report
# ---------------------------------------------------------------------------


def test_fts_parity_report(postgres_backend):
    """Quantify the one branch that cannot be numerically exact.

    ADR-0022 requires ranking drift to be *shown* against the fixtures. The
    numbers are printed on every run so they are read rather than inferred
    from a green tick, and three things are asserted:

    * the match set is identical for every query — if `plainto_tsquery` over
      `deepwiki_porter` stops selecting the rows FTS5 selected, the fused
      ranking's input changes and every downstream ranking with it;
    * no pair of documents that FTS5 separated is inverted;
    * the evidence is not vacuous — at least four queries must return a
      multi-row FTS result whose scores are genuinely separated, so a port
      cannot pass by only ever being tested on empty and degenerate results.

    The last one is there because the P0 fixture set originally failed it: of
    its seven queries, six returned 0 or 1 FTS rows and the seventh returned a
    13-row block spanning 2.7e-7. Four discriminating queries were added when
    this backend was built and that gap became visible.
    """
    min_discriminating_queries = 4

    rows = []
    discriminating = 0
    total_inversions = 0

    for slug, fixture in QUERIES:
        recorded = fixture["rankings"]["fts"]["results"]
        recorded_ids = [row["node_id"] for row in recorded]
        recorded_scores = [row["fts_rank"] for row in recorded]
        actual = postgres_backend.search_fts(
            fixture["query"], limit=fixture["parameters"]["fts_pool"]
        )
        actual_ids = ids(actual)

        spread = (
            max(recorded_scores) - min(recorded_scores) if recorded_scores else 0.0
        )
        separated = len(recorded_ids) > 1 and spread > TOLERANCE
        if separated:
            discriminating += 1

        inversions = discordant_pairs(actual_ids, recorded_ids) if separated else 0
        total_inversions += inversions

        magnitude = ""
        if recorded_scores and actual:
            legacy_best = abs(recorded_scores[0])
            pg_best = abs(actual[0].scores["fts_rank"])
            if legacy_best > 0:
                magnitude = f"{pg_best / legacy_best:.3g}x"

        rows.append(
            (
                slug,
                len(recorded_ids),
                len(actual_ids),
                set(recorded_ids) == set(actual_ids),
                spread,
                separated,
                inversions,
                magnitude,
            )
        )

    print("\nFTS parity report — legacy SQLite FTS5 vs PostgreSQL tsvector")
    print(
        f"{'query':<26}{'rows':>5}{'pg':>4}{'set':>6}{'spread':>11}"
        f"{'discrim':>9}{'inversions':>12}{'|score| ratio':>15}"
    )
    for slug, n, pg_n, same_set, spread, separated, inversions, magnitude in rows:
        print(
            f"{slug:<26}{n:>5}{pg_n:>4}{'ok' if same_set else 'DIFF':>6}"
            f"{spread:>11.6f}{'yes' if separated else '-':>9}"
            f"{inversions:>12}{magnitude:>15}"
        )
    print(
        f"discriminating queries: {discriminating}/{len(rows)}   "
        f"total inversions: {total_inversions}"
    )
    print(
        "score magnitudes differ by design: FTS5 clamps a common term's idf to "
        "1e-6, this backend does not."
    )

    assert all(row[3] for row in rows), (
        "the FTS match set diverged; plainto_tsquery over deepwiki_porter no "
        "longer selects the same rows FTS5 did"
    )
    assert total_inversions == 0, (
        f"{total_inversions} document pairs that FTS5 separated are inverted "
        "here; that is a ranking change, not a tokenizer artefact"
    )
    assert discriminating >= min_discriminating_queries, (
        f"only {discriminating} queries produce a separated multi-row FTS "
        f"result; at least {min_discriminating_queries} are needed for this "
        "gate to mean anything. Add discriminating queries to the P0 "
        "retrieval fixtures rather than lowering this bound."
    )
