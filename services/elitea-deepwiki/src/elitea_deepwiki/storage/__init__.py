"""Retrieval index storage.

:mod:`base` defines the ``RetrievalBackend`` interface and the frozen weighted
RRF. :mod:`postgres` is the target implementation (ADR-0022 decision 3);
:mod:`sqlite` wraps the verbatim legacy modules in :mod:`legacy` as the
reference the PostgreSQL backend is measured against.

Neither backend is imported here. Each pulls in its own optional dependency
group — ``storage-postgres`` or ``storage-legacy`` — and the SPI shell must be
able to start without either.
"""

from .base import Hit, Node, RetrievalBackend, rrf_fuse

__all__ = ["Hit", "Node", "RetrievalBackend", "rrf_fuse"]
