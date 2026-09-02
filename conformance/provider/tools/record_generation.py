#!/usr/bin/env python3
"""Record the composed ``generate_wiki`` artifact set as parity fixtures.

``generate_wiki`` is the one tool whose value is a *set* of artifacts rather
than a string, and ADR-0022 freezes that set.  This tool records it without
running an LLM by supplying the deterministic sample repository's page content
directly and letting the legacy composition code do the rest:

* ``plugin_implementation/artifact_export.py::ArtifactExporter._export_json_format``
  produces the real ``wiki_structure`` JSON from ``WikiStructureSpec`` /
  ``WikiPage`` models, including the ``_create_safe_filename`` page naming;
* ``plugin_implementation/registry_manager.py::WikiRegistryManager.register_wiki``
  produces the real registry entry and the real ``_registry/wikis.json`` body,
  against an in-memory artifact client;
* ``plugin_implementation/registry_manager.py::normalize_wiki_id`` and
  ``repository_identity.py::rebase_artifact_name`` produce the real wiki id and
  artifact paths;
* ``methods/invoke.py::perform_invoke_request`` is executed with
  ``self.generate_wiki`` stubbed to return a canned worker result, so the
  recorded ``result_objects`` list is the legacy composition code's own output.

The manifest builder is inline in ``wiki_subprocess_worker.py`` rather than a
callable, so ``build_manifest`` here restates it; the fields that can be
computed by legacy code (wiki id, page paths, analysis key) are, and the
provenance block pins the worker file so the restatement cannot drift silently.

Outputs (under ``fixtures/generation/``):

    wiki_structure.json          the analysis/wiki_structure_*.json artifact
    wiki_manifest.json           the {wiki_id}/wiki_manifest_{version}.json artifact
    page_names.json             page markdown artifact names and the naming rules
    registry_entry.json          the registry entry + the whole _registry/wikis.json
    composed_result.json         the generate_wiki result_objects list, recorded
                                 out of perform_invoke_request
    artifact_layout.json         the bucket layout the artifacts land in

Usage:
    python tools/record_generation.py [--check]
"""

from __future__ import annotations

import argparse
import json
import sys
import types
from pathlib import Path
from typing import Any, Dict, List

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _legacy import install_pylon_stub, legacy_root, source_pin  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "fixtures" / "deepwiki" / "generation"

SOURCE_FILES = [
    "methods/invoke.py",
    "plugin_implementation/artifact_export.py",
    "plugin_implementation/registry_manager.py",
    "plugin_implementation/repository_identity.py",
    "plugin_implementation/wiki_subprocess_worker.py",
]

REPOSITORY = "acme/notes-service"
BRANCH = "main"
COMMIT_HASH = "0000000deadbeef0000000deadbeef0000000000"
REPO_IDENTIFIER = f"{REPOSITORY}:{BRANCH}:{COMMIT_HASH[:7]}"
WIKI_VERSION_ID = "20260101T000000Z-0000000a"
PROVIDER_TYPE = "github"
DEFAULT_BUCKET = "wiki-artifacts"

#: The pages a generation of the sample repository produces.  Content is
#: deliberately short: these fixtures gate composition and naming, not prose.
PAGES = [
    ("Overview", "Getting Started", "# Overview\n\nThe notes service stores notes and answers search queries.\n"),
    ("Overview", "Architecture & Data Flow", "# Architecture & Data Flow\n\n`api.py` authenticates, then delegates to the store.\n"),
    ("Components", "Note Storage", "# Note Storage\n\n`NoteStore` wraps a SQLite connection.\n"),
    ("Components", "Search Ranking", "# Search Ranking\n\n`rank_notes` scores by term overlap.\n"),
    ("Components", "Bearer Tokens", "# Bearer Tokens\n\n`issue_token` and `verify_token` sign and check subjects.\n"),
]

REPOSITORY_CONTEXT = json.dumps(
    {
        "executive_summary": "A small notes service with SQLite persistence.",
        "core_purpose": "Store, search and authorise access to notes.",
    },
    indent=2,
)


def _import_legacy():
    root = legacy_root()
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from plugin_implementation import artifact_export, registry_manager  # noqa
    from plugin_implementation import repository_identity  # noqa
    from plugin_implementation.state.wiki_state import (  # noqa
        PageSpec,
        SectionSpec,
        WikiPage,
        WikiStructureSpec,
    )

    return (
        artifact_export,
        registry_manager,
        repository_identity,
        (PageSpec, SectionSpec, WikiPage, WikiStructureSpec),
    )


class InMemoryArtifactClient:
    """Artifact client that keeps every upload in a dict.

    Implements the two methods ``WikiRegistryManager`` calls; the legacy
    ``MiniArtifactClient`` in ``methods/invoke.py`` is the HTTP version of the
    same interface.
    """

    def __init__(self) -> None:
        self.objects: Dict[str, bytes] = {}

    def download_artifact(self, bucket_name: str, artifact_name: str) -> bytes:
        key = f"{bucket_name}/{artifact_name}"
        if key not in self.objects:
            raise RuntimeError(f"Artifact not found: {key}")
        return self.objects[key]

    def create_artifact(self, bucket_name: str, artifact_name: str, data) -> Dict:
        if isinstance(data, str):
            data = data.encode("utf-8")
        self.objects[f"{bucket_name}/{artifact_name}"] = data
        return {"status": "ok"}


def build_structure_and_pages(models):
    PageSpec, SectionSpec, WikiPage, WikiStructureSpec = models

    sections: List[Any] = []
    pages: List[Any] = []
    section_names: List[str] = []
    for title, _, _ in PAGES:
        if title not in section_names:
            section_names.append(title)

    for section_idx, section_name in enumerate(section_names):
        page_specs = []
        for page_idx, (sec, page_title, content) in enumerate(
            [p for p in PAGES if p[0] == section_name]
        ):
            page_specs.append(
                PageSpec(
                    page_name=page_title,
                    page_order=page_idx,
                    description=f"{page_title} of the notes service",
                    content_focus=page_title,
                    rationale=f"Readers need {page_title.lower()}",
                )
            )
            pages.append(
                WikiPage(
                    page_id=f"{section_idx}#{page_idx}",
                    title=page_title,
                    content=content,
                    status="completed",
                )
            )
        sections.append(
            SectionSpec(
                section_name=section_name,
                section_order=section_idx,
                description=f"{section_name} of the notes service",
                rationale=f"Groups the {section_name.lower()} pages",
                pages=page_specs,
            )
        )

    structure = WikiStructureSpec(
        wiki_title="notes-service",
        overview="A small notes service with SQLite persistence.",
        sections=sections,
        total_pages=len(pages),
    )
    return structure, pages


def build_manifest(registry_manager, repository_identity, page_names, analysis_key):
    """Restate the manifest built inline in wiki_subprocess_worker.py.

    Only the *values* are restated; wiki id, page paths and the analysis key
    come from the legacy helpers.
    """
    wiki_id = registry_manager.normalize_wiki_id(REPO_IDENTIFIER)
    return {
        "schema_version": 2,
        "wiki_id": wiki_id,
        "wiki_title": "notes-service",
        "description": "A small notes service with SQLite persistence."
        " Store, search and authorise access to notes.",
        "wiki_version_id": WIKI_VERSION_ID,
        "created_at": "2026-01-01T00:00:00+00:00",
        "canonical_repo_identifier": REPO_IDENTIFIER,
        "repository": REPOSITORY,
        "branch": BRANCH,
        "commit_hash": COMMIT_HASH,
        "analysis_key": analysis_key,
        "pages": page_names,
        "provider_type": PROVIDER_TYPE,
        # Cache keys are attached only when the legacy cache index resolves
        # them; each one names a file that ADR-0022 decision 3 replaces with
        # PostgreSQL rows. They are listed here so the port has to account for
        # every one of them.
        "faiss_cache_key": "<md5>",
        "graph_cache_key": "<md5>",
        "docstore_cache_key": "<md5>",
        "docstore_files": ["<md5>.docstore.bin", "<md5>.doc_index.json"],
        "bm25_cache_key": "<md5>",
        "bm25_files": ["<md5>.bm25.sqlite"],
        "unified_db_key": "<md5>",
        "unified_db_files": ["<md5>.wiki.db"],
        "analysis_cache_key": "<md5 of analysis_key>",
    }


def record_composed_result(structure_artifact, page_artifacts, manifest, wiki_id):
    """Run perform_invoke_request with a stubbed generate_wiki and record it."""
    install_pylon_stub()

    # methods/invoke.py imports tasknode_task lazily inside the function.
    tasknode = types.ModuleType("tasknode_task")
    tasknode.id = "invocation_0000000000000000"
    tasknode.meta = {"toolkit_name": "Wikis", "tool_name": "generate_wiki"}
    sys.modules["tasknode_task"] = tasknode

    import importlib.util

    source = legacy_root() / "methods" / "invoke.py"
    spec = importlib.util.spec_from_file_location(
        "deepwiki_legacy_method_invoke_gen", source
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)

    worker_result = {
        "success": True,
        "result": "Wiki generated: 5 pages across 2 sections",
        "artifacts": [structure_artifact] + page_artifacts + [
            {
                "name": f"{wiki_id}/wiki_manifest_{WIKI_VERSION_ID}.json",
                "object_type": "wiki_manifest",
                "type": "application/json",
                "data": json.dumps(manifest, indent=2, ensure_ascii=False),
            }
        ],
        "repository_context": REPOSITORY_CONTEXT,
        "wiki_id": wiki_id,
        "wiki_version_id": WIKI_VERSION_ID,
        "canonical_repo_identifier": REPO_IDENTIFIER,
        "commit_hash": COMMIT_HASH,
        "provider_type": PROVIDER_TYPE,
        "branch": BRANCH,
        "wiki_title": "notes-service",
        "wiki_description": "A small notes service with SQLite persistence.",
        "analysis_key": manifest["analysis_key"],
    }

    calls: List[Dict[str, Any]] = []

    class _Module:
        def invocation_stop_checkpoint(self):
            return None

        def generate_wiki(self, **kwargs):
            calls.append(kwargs)
            return worker_result

        _create_error_response = mod.Method._create_error_response

    module_self = _Module()
    request_data = {
        "configuration": {
            "parameters": {
                "code_toolkit": {
                    "github_configuration": {
                        "url": "https://github.com",
                        "repository": REPOSITORY,
                        "active_branch": BRANCH,
                    }
                },
                "llm_settings": {
                    "model_name": "gpt-4o",
                    "api_base": "http://elitea/llm/v1",
                    "api_key": "<redacted>",
                    "organization": "42",
                },
                "embedding_model": {"model_name": "text-embedding-3-small"},
            }
        },
        "parameters": {"query": "Document the notes service"},
    }

    response = mod.Method.perform_invoke_request(
        module_self, "Wikis", "generate_wiki", request_data
    )
    result_objects = json.loads(response["result"])
    return response, result_objects, calls


def build() -> Dict[Path, Any]:
    artifact_export, registry_manager, repository_identity, models = _import_legacy()

    wiki_id = registry_manager.normalize_wiki_id(REPO_IDENTIFIER)
    analysis_key = f"{REPO_IDENTIFIER}@{WIKI_VERSION_ID}"

    structure, pages = build_structure_and_pages(models)
    exporter = artifact_export.ArtifactExporter(wiki_id=wiki_id)
    structure_artifacts = exporter._export_json_format(structure, pages)
    structure_artifact = dict(structure_artifacts[0])
    # The exporter timestamps the filename; pin it so the fixture is stable.
    structure_artifact["name"] = f"{wiki_id}/analysis/wiki_structure_TIMESTAMP.json"

    # Page artifacts as the wiki agent emits them, then rebased by the worker.
    page_artifacts = []
    for section_name, page_title, content in PAGES:
        raw_name = (
            f"wiki_pages/{exporter._create_safe_filename(section_name)}/"
            f"{exporter._create_safe_filename(page_title)}.md"
        )
        page_artifacts.append(
            {
                "name": repository_identity.rebase_artifact_name(
                    raw_name, wiki_id=wiki_id, subfolder="wiki_pages"
                ),
                "type": "text/markdown",
                "data": content,
                "_raw_name": raw_name,
            }
        )
    page_names = [artifact["name"] for artifact in page_artifacts]

    manifest = build_manifest(
        registry_manager, repository_identity, page_names, analysis_key
    )

    # Registry, through the real manager against an in-memory bucket.
    client = InMemoryArtifactClient()
    manager = registry_manager.WikiRegistryManager(client, DEFAULT_BUCKET)
    entry = manager.register_wiki(
        wiki_id=wiki_id,
        repo=REPOSITORY,
        branch=BRANCH,
        provider=PROVIDER_TYPE,
        host="github.com",
        display_name="notes-service",
        description=manifest["description"],
        commit_hash=COMMIT_HASH,
        canonical_repo_identifier=REPO_IDENTIFIER,
        analysis_key=analysis_key,
        stats={"page_count": len(PAGES)},
    )
    registry_body = json.loads(
        client.objects[f"{DEFAULT_BUCKET}/{registry_manager.REGISTRY_PATH}"].decode()
    )

    def _pin_times(value):
        if isinstance(value, dict):
            return {
                k: ("<timestamp>" if k in ("created_at", "updated_at") else _pin_times(v))
                for k, v in value.items()
            }
        if isinstance(value, list):
            return [_pin_times(v) for v in value]
        return value

    entry = _pin_times(entry)
    registry_body = _pin_times(registry_body)

    response, result_objects, calls = record_composed_result(
        {k: v for k, v in structure_artifact.items()},
        [{k: v for k, v in a.items() if k != "_raw_name"} for a in page_artifacts],
        manifest,
        wiki_id,
    )

    pin = source_pin(SOURCE_FILES)

    return {
        FIXTURES
        / "wiki_structure.json": {
            "_source": pin,
            "producer": "ArtifactExporter._export_json_format",
            "artifact": structure_artifact,
            "body": json.loads(structure_artifact["data"]),
            "naming": {
                "template": "{wiki_id}/analysis/wiki_structure_{YYYYmmdd_HHMMSS}.json",
                "note": "the timestamp is local wall clock, so the artifact name is"
                " not reproducible; the port should make it deterministic"
                " (wiki_version_id) and the fixture pins the body, not the name",
            },
            "shape": {
                "wiki_title": "str",
                "sections": "[{section_name, pages: [{page_name, page_content}]}]",
            },
            "notes": [
                "Sections with no matching generated page are dropped entirely.",
                "Pages are matched to the structure by the page_id '{section}#{page}';"
                " a title match is the fallback.",
                "page_content is embedded in full — the structure JSON duplicates"
                " every page's markdown.",
            ],
        },
        FIXTURES
        / "wiki_manifest.json": {
            "_source": pin,
            "producer": "wiki_subprocess_worker.py (inline manifest build)",
            "restated": True,
            "artifact_name": f"{wiki_id}/wiki_manifest_{WIKI_VERSION_ID}.json",
            "body": manifest,
            "notes": [
                "schema_version 2 means folder-structured artifacts"
                " ({wiki_id}/...); version 1 wikis are flat.",
                "wiki_version_id is '%Y%m%dT%H%M%SZ-<uuid4[:8]>' and every"
                " generation writes a NEW manifest — manifests accumulate.",
                "analysis_key is '{repo}:{branch}:{commit8}@{wiki_version_id}';"
                " ask/deep_research pin a wiki version through it.",
                "Every *_cache_key / *_files entry names a per-wiki file that"
                " ADR-0022 decision 3 replaces with PostgreSQL rows; the port must"
                " decide, per key, whether the manifest still carries it.",
            ],
        },
        FIXTURES
        / "page_names.json": {
            "_source": pin,
            "producers": [
                "ArtifactExporter._create_safe_filename",
                "repository_identity.rebase_artifact_name",
            ],
            "wiki_id": wiki_id,
            "wiki_id_rule": "registry_manager.normalize_wiki_id:"
            " '{owner}--{repo}--{branch}', lowercased, every non [a-z0-9-] char"
            " becomes '-', runs collapse, path segments joined with '--'",
            "safe_filename_rule": "strip everything but word chars/space/dash,"
            " collapse dash+space runs to '-', strip dashes, lowercase",
            "rebase_rule": "an already-{wiki_id}-prefixed name is kept; otherwise"
            " the part below the subfolder is rebased under"
            " {wiki_id}/{subfolder}/",
            "pages": [
                {
                    "section": section,
                    "title": title,
                    "raw_name": artifact["_raw_name"],
                    "artifact_name": artifact["name"],
                }
                for (section, title, _), artifact in zip(PAGES, page_artifacts)
            ],
            "manifest_pages": page_names,
        },
        FIXTURES
        / "registry_entry.json": {
            "_source": pin,
            "producer": "WikiRegistryManager.register_wiki",
            "registry_path": f"{DEFAULT_BUCKET}/{registry_manager.REGISTRY_PATH}",
            "entry": entry,
            "registry_body": registry_body,
            "notes": [
                "The whole registry is one mutable JSON blob in the artifact"
                " bucket: register_wiki does read-modify-write with no locking,"
                " so two concurrent generations lose one of the entries."
                " ADR-0022 decision 3 replaces it with a `wikis` table.",
                "artifact_status is written as all-true unconditionally — it"
                " records intent, not the presence of the artifacts.",
                "created_at is preserved on update; updated_at is rewritten."
                " Both are naive datetime.utcnow() + 'Z'.",
            ],
        },
        FIXTURES
        / "composed_result.json": {
            "_source": pin,
            "producer": "methods/invoke.py::perform_invoke_request",
            "how_recorded": "self.generate_wiki stubbed to return a canned worker"
            " result; every line of the composition path below it is legacy code",
            "engine_call": calls[0] if calls else None,
            "response": {k: v for k, v in response.items() if k != "result"},
            "result_objects": result_objects,
            "composition_rules": [
                "result is a JSON *string* holding the list of result objects;"
                " result_type is always 'String'.",
                "object[0] is always the response message (result['result']).",
                "Partial failures append extra response messages: a '⚠️ Partial"
                " issues detected' summary, then a 'Failed pages:' list, then an"
                " 'Errors:' list.",
                "JSON artifacts are classified wiki_manifest when the name contains"
                " 'wiki_manifest_', else wiki_structure; a nameless JSON body with"
                " wiki_version_id + pages is sniffed as a manifest.",
                "Markdown artifacts become wiki_page objects with the md extension.",
                "repository_context is appended as a repository_context artifact at"
                " {wiki_id}/repository_context.txt (or uploaded directly in jobs"
                " mode, where Pylon would strip the directory prefix).",
                "Artifacts flagged _uploaded_directly are skipped so the worker's"
                " own upload is not duplicated.",
                "Every artifact object carries result_bucket 'wiki-artifacts' —"
                " the descriptor advertises bucket 'wiki'. The two disagree and"
                " the invoke-time value wins.",
            ],
        },
        FIXTURES
        / "artifact_layout.json": {
            "_source": pin,
            "bucket": DEFAULT_BUCKET,
            "descriptor_declares_bucket": "wiki",
            "layout": {
                "_registry/wikis.json": "global registry (all wikis, all projects)",
                f"{wiki_id}/wiki_manifest_{{version}}.json": "one per generation",
                f"{wiki_id}/analysis/wiki_structure_{{ts}}.json": "structure + page bodies",
                f"{wiki_id}/wiki_pages/{{section}}/{{page}}.md": "one per page",
                f"{wiki_id}/repository_context.txt": "LLM repository analysis",
                f"{wiki_id}/{{hash}}.wiki.db": "unified index (nodes/edges/FTS/vec)",
                f"{wiki_id}/{{hash}}.bm25.sqlite": "standalone BM25 postings",
                f"{wiki_id}/{{hash}}.docstore.bin + .doc_index.json": "mmap docstore",
                f"{wiki_id}/{{hash}}.faiss": "legacy FAISS vectorstore",
                f"{wiki_id}/combined.code_graph.gz": "compressed code graph",
            },
            "target": "ADR-0022 decision 4: pages/manifests/structure move to the"
            " ADR-0016 object-storage layout under the tenant prefix; every index"
            " file above becomes PostgreSQL rows; the registry becomes a table.",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    outputs = build()

    if args.check:
        drift = []
        for path, payload in outputs.items():
            want = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
            if not path.is_file() or path.read_text(encoding="utf-8") != want:
                drift.append(str(path))
        if drift:
            print("generation fixtures are stale:", file=sys.stderr)
            for item in drift:
                print(f"  {item}", file=sys.stderr)
            return 1
        print("generation fixtures match the legacy plugin")
        return 0

    for path, payload in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
