"""Verbatim copies of the legacy DeepWiki storage modules.

These four files are a **plain copy** from ``deepwiki_plugin`` at revision
``ce679f11dc31c209cc67f13565b286d5bb28ce58``, unmodified except for this
package marker:

    plugin_implementation/constants.py    4030c459261afb62bc19f9ae284d6a8f743443b30211b88b80e2b36368bccabb
    plugin_implementation/unified_db.py   1d2a44e6317effbd9806a539ea30fdd7f15e49140551f5f5d2a6426840e9a3c5
    plugin_implementation/bm25_disk.py    beac75986d86a776a52d9402fda8859e8b43f73ea9efb02a8c491e799c7b744e
    plugin_implementation/docstore.py     7fb251ab3b51e13eaabb3f2104c5077fc88a81dfaebb1664186cfa14dc9450c1

``tests/storage/test_legacy_copy_is_verbatim.py`` re-checks those digests, so
an accidental edit here fails the build. Deliberate edits belong in a commit
that updates the digests and says why.

Why keep them at all, when ADR-0022 decision 3 replaces this storage layer with
PostgreSQL: they are the **reference implementation** the PostgreSQL backend is
measured against. The P0 retrieval fixtures were recorded from exactly this
code, and ``storage/sqlite.py`` wraps it as a live backend so a parity run
compares two working implementations rather than a new one against a JSON file.

They are also the only part of the engine that has moved so far. The rest of
``plugin_implementation/`` arrives in a later slice of P1.
"""
