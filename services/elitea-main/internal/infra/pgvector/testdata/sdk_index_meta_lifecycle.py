"""Exercise the installed Elitea SDK's index-meta lifecycle against PgVector."""

from __future__ import annotations

import os

from elitea_sdk.tools.base_indexer_toolkit import BaseIndexerToolkit


class DeterministicEmbeddings:
    """Minimal embedding implementation for the metadata-only lifecycle."""

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [[0.25, 0.5, 0.75] for _ in texts]

    def embed_query(self, _: str) -> list[float]:
        return [0.25, 0.5, 0.75]


def main() -> None:
    connection_string = os.environ["ELITEA_TEST_DATABASE_URL"]
    if connection_string.startswith("postgres://"):
        connection_string = connection_string.replace(
            "postgres://",
            "postgresql+psycopg://",
            1,
        )
    elif connection_string.startswith("postgresql://"):
        connection_string = connection_string.replace(
            "postgresql://",
            "postgresql+psycopg://",
            1,
        )

    index_name = os.environ["ELITEA_TEST_INDEX_NAME"]
    toolkit = BaseIndexerToolkit(
        llm=None,
        embeddings=DeterministicEmbeddings(),
        connection_string=connection_string,
        collection_schema=os.environ["ELITEA_TEST_SCHEMA"],
        toolkit_id=int(os.environ["ELITEA_TEST_TOOLKIT_ID"]),
    )
    toolkit.index_meta_init(index_name, {"index_name": index_name})
    toolkit.index_meta_update(
        index_name,
        "completed",
        result=228,
        skipped={
            "items_processed": 66,
            "total_fetched": 66,
            "total_skipped": 5,
        },
        docs_count=61,
    )


if __name__ == "__main__":
    main()
