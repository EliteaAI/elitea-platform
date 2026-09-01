#!/usr/bin/env python3
"""Capture the legacy DeepWiki provider descriptor as a golden fixture.

The descriptor is produced by ``methods/descriptor.py::provider_descriptor``,
a Pylon ``@web.method`` that reads a single config value
(``service_location_url``) and otherwise returns a literal dict.  This tool
imports that file verbatim (with a stubbed ``pylon.core.tools``), calls the
method against a fake module ``self`` whose config is pinned to the legacy
default, and writes:

* ``fixtures/descriptor/legacy-v0/provider_descriptor.json`` — the descriptor,
  byte-stable (sorted keys are *not* used: legacy key order is preserved, which
  is what the legacy-v0 adapter must accept);
* ``fixtures/descriptor/legacy-v0/descriptor.inventory.json`` — a derived
  inventory (toolkits, declared tools, unique tool names, argument schemas)
  that the P1 conversion pipeline asserts against;
* ``fixtures/descriptor/legacy-v0/bundle.manifest.json`` — source pins for the
  descriptor file and for the three verbatim legacy-v0 schema documents named
  by spec-provider-service.

Usage:
    python tools/capture_descriptor.py [--check]

``--check`` re-captures and fails if the committed fixtures differ, which is
how CI detects legacy drift while the plugin is still alive.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _legacy import (  # noqa: E402
    legacy_root,
    load_legacy_module,
    sha256_of,
    source_pin,
)

def fixtures_for(provider: str) -> Path:
    """Where one provider's descriptor fixtures live.

    Per-provider since P1.0: this recorder has a SECOND provider now, and the
    directory is the only thing that had to change to record it. The legacy
    method it loads (``methods/descriptor.py::Method.provider_descriptor``) is
    the same file name in both plugins, and both emit the same four top-level
    keys — which is the evidence that the SPI contract is generic rather than a
    description of DeepWiki.
    """
    return Path(__file__).resolve().parents[1] / "fixtures" / provider / "descriptor" / "legacy-v0"

#: The legacy default; the deployed value is environment-specific and is
#: deliberately normalised out of the fixture (P1 replaces it with a reviewed
#: origin registration, per spec-provider-service).
PINNED_SERVICE_LOCATION_URL = "http://127.0.0.1:8080"

#: Verbatim legacy-v0 schema documents, pinned by digest but not copied here
#: (spec-provider-service places the copies under libs/provider/legacy/v0/).
LEGACY_V0_SCHEMA_FILES = (
    "data/ExternalServiceProviderDescriptor.json",
    "data/epam_ai_run.spi.json",
    "data/epam_ai_run.spi.schema.json",
)


class _FakeDescriptor:
    """Stand-in for the Pylon plugin descriptor object."""

    def __init__(self, config: Dict[str, Any]):
        self.config = config


class _FakeModule:
    """Stand-in for the Pylon module instance the method binds to."""

    def __init__(self, config: Dict[str, Any]):
        self.descriptor = _FakeDescriptor(config)


def capture() -> Dict[str, Any]:
    """Return the descriptor exactly as the legacy method emits it."""
    mod = load_legacy_module("methods/descriptor.py", "deepwiki_legacy_descriptor")
    module_self = _FakeModule({"service_location_url": PINNED_SERVICE_LOCATION_URL})
    return mod.Method.provider_descriptor(module_self)


def build_inventory(descriptor: Dict[str, Any]) -> Dict[str, Any]:
    """Derive the toolkit/tool inventory the P1 conversion asserts against."""
    toolkits: List[Dict[str, Any]] = []
    declared = 0
    unique: Dict[str, List[str]] = {}

    for toolkit in descriptor["provided_toolkits"]:
        tools = []
        for tool in toolkit["provided_tools"]:
            declared += 1
            unique.setdefault(tool["name"], []).append(toolkit["name"])
            args = tool.get("args_schema") or {}
            tools.append(
                {
                    "name": tool["name"],
                    "tool_result_type": tool.get("tool_result_type"),
                    "sync_invocation_supported": tool.get("sync_invocation_supported"),
                    "async_invocation_supported": tool.get("async_invocation_supported"),
                    "result_composition": (tool.get("tool_metadata") or {}).get(
                        "result_composition"
                    ),
                    "result_object_types": [
                        obj.get("object_type")
                        for obj in (tool.get("tool_metadata") or {}).get(
                            "result_objects", []
                        )
                    ],
                    "args_schema": {
                        arg_name: {
                            "type": arg.get("type"),
                            "required": bool(arg.get("required", False)),
                            "has_default": "default" in arg,
                            "default": arg.get("default"),
                        }
                        for arg_name, arg in args.items()
                    },
                }
            )

        config = toolkit.get("toolkit_config") or {}
        toolkits.append(
            {
                "name": toolkit["name"],
                "type_override": (toolkit.get("toolkit_metadata") or {}).get(
                    "type_override"
                ),
                "application": (toolkit.get("toolkit_metadata") or {}).get(
                    "application", False
                ),
                "required_context": (toolkit.get("toolkit_metadata") or {}).get(
                    "required_context", []
                ),
                "config_type": config.get("type"),
                "fields_order": config.get("fields_order", []),
                "config_parameters": {
                    name: {
                        "type": param.get("type"),
                        "required": bool(param.get("required", False)),
                        "default": param.get("default"),
                        "json_schema_extra": param.get("json_schema_extra"),
                    }
                    for name, param in (config.get("parameters") or {}).items()
                },
                "declared_tools": tools,
            }
        )

    return {
        "provider_name": descriptor["name"],
        "provided_ui": [
            {"name": ui["name"], "path": ui["path"], "headers": ui["headers"]}
            for ui in descriptor["configuration"]["provided_ui"]
        ],
        "toolkit_count": len(toolkits),
        "declared_tool_count": declared,
        "unique_tool_count": len(unique),
        "unique_tool_names": sorted(unique),
        "tool_declarations": {name: sorted(v) for name, v in sorted(unique.items())},
        "toolkits": toolkits,
    }


def build_bundle_manifest() -> Dict[str, Any]:
    """Pin the descriptor source plus the three legacy-v0 schema documents."""
    manifest = source_pin(["methods/descriptor.py"])
    manifest["pinned_service_location_url"] = PINNED_SERVICE_LOCATION_URL

    core = legacy_root().parent / "elitea_core"
    schemas = []
    for rel in LEGACY_V0_SCHEMA_FILES:
        path = core / rel
        if path.is_file():
            schemas.append(
                {
                    "path": f"elitea_core/{rel}",
                    "bytes": path.stat().st_size,
                    "sha256": sha256_of(path),
                    "target": "libs/provider/legacy/v0/" + Path(rel).name,
                }
            )
        else:
            schemas.append({"path": f"elitea_core/{rel}", "status": "not_found"})
    manifest["legacy_v0_schema_documents"] = schemas
    return manifest


def _write(path: Path, payload: Dict[str, Any]) -> str:
    text = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return text


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail instead of writing when the committed fixture differs",
    )
    parser.add_argument(
        "--provider",
        default="deepwiki",
        help="which provider's fixture profile to write (default: deepwiki)",
    )
    args = parser.parse_args()

    fixtures = fixtures_for(args.provider)
    descriptor = capture()
    outputs = {
        fixtures / "provider_descriptor.json": descriptor,
        fixtures / "descriptor.inventory.json": build_inventory(descriptor),
    }
    # The bundle manifest pins the legacy v0 SCHEMA DOCUMENTS, which belong to
    # elitea_core and are the same for every provider. Written once, with
    # DeepWiki's profile, rather than duplicated per provider — two copies
    # would be two things to keep byte-identical.
    if args.provider == "deepwiki":
        outputs[fixtures / "bundle.manifest.json"] = build_bundle_manifest()

    if args.check:
        drift = []
        for path, payload in outputs.items():
            want = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
            if not path.is_file() or path.read_text(encoding="utf-8") != want:
                drift.append(str(path))
        if drift:
            print("descriptor fixtures are stale:", file=sys.stderr)
            for item in drift:
                print(f"  {item}", file=sys.stderr)
            return 1
        print("descriptor fixtures match the legacy plugin")
        return 0

    for path, payload in outputs.items():
        _write(path, payload)
        print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
