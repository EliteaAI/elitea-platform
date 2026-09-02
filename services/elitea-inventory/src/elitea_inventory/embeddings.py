"""Entity embeddings, through the platform gateway.

The legacy plugin embedded entities with a LOCAL ``all-MiniLM-L6-v2`` through
``langchain_community.HuggingFaceEmbeddings``, downloaded on first use into
``/data/embeddings`` and pinned in the code with this comment:

    Always use a deterministic local model (all-MiniLM-L6-v2) to avoid
    configuration drift: platform embedding models can change/be removed, but
    the local model is pinned — ensuring ingestion and retrieval always produce
    vectors in the same space.

The reasoning is right and the mechanism is wrong. It costs the image
``sentence-transformers`` + ``torch`` (multi-GB), it needs egress to a model
host at runtime, and it makes the provider the only component on the platform
that embeds outside the gateway — so none of it is metered, budgeted or logged.

v1 embeds through the gateway instead, with the model the toolkit configures
(``embedding_model``), and keeps the drift guarantee by RECORDING the model in
the graph rather than by pinning it in code: :func:`stamp` writes the model and
its dimension into the graph's metadata at ingestion, and :func:`check`
refuses a retrieval whose graph was built in a different space. The legacy code
could not have made that check — with one hardcoded model there was nothing to
compare — and would silently return nonsense similarity if the pin ever moved.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

#: Where the model and dimension are recorded in the persisted graph.
METADATA_MODEL_KEY = "embeddings_model"
METADATA_DIMENSION_KEY = "embeddings_dimension"


class EmbeddingsUnavailable(ValueError):
    """No embedding model was configured, so semantic search cannot be built."""


class EmbeddingsModelMismatch(ValueError):
    """A loaded graph's vectors are in a different space than the resolved model.

    ``ValueError``, so the contract classifies it as ``invalid_input``: the
    configuration the caller supplied disagrees with the data, and the fix is a
    configuration change or a re-ingestion — not a retry.
    """


def resolve_model(params: dict[str, Any]) -> str | None:
    """The embedding model for this invocation, or None when none is set.

    ``embedding_model`` is declared optional in the descriptor and the legacy
    UI leaves it empty by default, so "no model" is a normal state: ingestion
    then builds a graph with no vectors and lexical search still works.
    """
    for key in ("embedding_model", "toolkit_configuration_embedding_model"):
        value = params.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def build(model: str, llm_settings: dict[str, Any]) -> Any:
    """An embeddings client for ``model`` against the platform's LLM gateway.

    ``llm_settings`` is the per-invocation credential set the facade forwards —
    the same one the chat LLM is built from. ``api_base`` already points at the
    gateway's OpenAI-compatible surface (``…/llm/v1``); the key is the bearer
    the facade minted for THIS invocation, and ``organization`` scopes the spend
    to the calling project.
    """
    from langchain_openai import OpenAIEmbeddings  # noqa: PLC0415

    api_base = llm_settings.get("api_base") or llm_settings.get("openai_api_base")
    api_key = llm_settings.get("api_key") or llm_settings.get("openai_api_key")
    organization = (
        llm_settings.get("organization")
        or llm_settings.get("openai_organization")
        or llm_settings.get("project_id")
    )
    if not api_base or not api_key:
        raise EmbeddingsUnavailable(
            f"embedding_model {model!r} is configured but the request carried no "
            f"LLM transport (llm_settings.api_base / api_key), so entity "
            f"embeddings cannot be generated through the platform gateway"
        )

    kwargs: dict[str, Any] = {
        "model": model,
        "base_url": str(api_base),
        "api_key": str(api_key),
        # The gateway rejects an unknown dimension for models that do not
        # support the parameter, and langchain sends it whenever it thinks it
        # knows the model. It does not know the platform's model names.
        "check_embedding_ctx_length": False,
    }
    if organization:
        kwargs["organization"] = str(organization)
    return OpenAIEmbeddings(**kwargs)


def _metadata_of(graph: Any) -> dict[str, Any] | None:
    """The graph's metadata dict.

    ``KnowledgeGraph`` keeps it in ``_metadata`` and serialises it under
    ``_metadata`` too. The public-looking ``metadata`` is checked first only so
    that a test double can supply one.
    """
    for attribute in ("metadata", "_metadata"):
        value = getattr(graph, attribute, None)
        if isinstance(value, dict):
            return value
    return None


def stamp(graph: Any, model: str | None, dimension: int | None) -> None:
    """Record the embedding space in the graph's metadata.

    Written at ingestion, read by :func:`check`. Absent metadata means a graph
    built before this stamp existed (or with no embeddings at all), which is
    NOT an error — see :func:`check`.

    This OVERWRITES what ``KnowledgeGraph.generate_embeddings`` records, and
    deliberately. That code stamps ``type(model).__name__`` plus a
    ``model_name`` attribute — for the gateway client the attribute is called
    ``model``, so the graph would be stamped the useless ``"OpenAIEmbeddings"``,
    identical for every platform model and therefore never a mismatch.
    """
    metadata = _metadata_of(graph)
    if metadata is None:
        return
    if model:
        metadata[METADATA_MODEL_KEY] = model
        if dimension:
            metadata[METADATA_DIMENSION_KEY] = int(dimension)


def recorded(graph: Any) -> tuple[str | None, int | None]:
    """The model and dimension a loaded graph was built with."""
    metadata = _metadata_of(graph) or {}
    model = metadata.get(METADATA_MODEL_KEY)
    dimension = metadata.get(METADATA_DIMENSION_KEY)
    return (str(model) if model else None), (int(dimension) if dimension else None)


def check(graph: Any, resolved: str | None) -> None:
    """Refuse a retrieval whose graph was embedded with a different model.

    Two silences are deliberate:

    * a graph with NO recorded model is allowed. It was built before this stamp
      existed or with no embeddings, and refusing it would break every existing
      graph on the platform at upgrade — the vectors, if any, are in the legacy
      MiniLM space and lexical search still answers.
    * a request with NO resolved model is allowed. Semantic search is simply not
      built, and every lexical tool works.

    What is refused is the case that silently returns nonsense: vectors in one
    space, a query embedded in another. Cosine similarity between them is a
    number, and it means nothing.
    """
    if not resolved:
        return
    stamped, _dimension = recorded(graph)
    if not stamped or stamped == resolved:
        return
    raise EmbeddingsModelMismatch(
        f"this graph's entity vectors were built with embedding model "
        f"{stamped!r}, but this toolkit is configured with {resolved!r}. "
        f"Similarity between two embedding spaces is meaningless, so semantic "
        f"search is refused rather than answered wrongly. Either set "
        f"embedding_model back to {stamped!r}, or re-ingest the sources to "
        f"rebuild the graph in the new space."
    )


def dimension_of(embeddings: Any) -> int | None:
    """The vector width of an embeddings client, by asking it to embed once.

    There is no portable attribute for this: the gateway serves whatever model
    the platform configured, and ``OpenAIEmbeddings.dimensions`` is None unless
    the caller pinned it. One short embedding is the honest way to find out, and
    it happens once per ingestion.
    """
    try:
        vector = embeddings.embed_query("dimension probe")
    except Exception:  # noqa: BLE001 - the width is a nicety, not the ingestion
        logger.warning("could not probe the embedding dimension", exc_info=True)
        return None
    try:
        return len(vector)
    except TypeError:  # pragma: no cover - a client that answers a non-sequence
        return None


__all__ = [
    "EmbeddingsModelMismatch",
    "EmbeddingsUnavailable",
    "METADATA_DIMENSION_KEY",
    "METADATA_MODEL_KEY",
    "build",
    "check",
    "dimension_of",
    "recorded",
    "resolve_model",
    "stamp",
]
