from __future__ import annotations

import ast
from pathlib import Path


def test_only_sdk_adapter_imports_elitea_sdk() -> None:
    source_root = Path(__file__).parents[2] / "src" / "elitea_worker"
    importers: list[Path] = []
    for path in source_root.rglob("*.py"):
        source = path.read_text(encoding="utf-8")
        tree = ast.parse(source)
        for node in ast.walk(tree):
            names: list[str] = []
            if isinstance(node, ast.Import):
                names.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                names.append(node.module)
            if any(name == "elitea_sdk" or name.startswith("elitea_sdk.") for name in names):
                importers.append(path.relative_to(source_root))
                break
        else:
            if "elitea_sdk.configurations" in source:
                importers.append(path.relative_to(source_root))
    assert importers == [Path("agents/sdk_adapter.py")]


def test_only_command_transport_modules_may_import_redis_client() -> None:
    source_root = Path(__file__).parents[2] / "src" / "elitea_worker"
    allowed = {
        Path("transport/redis_asyncio.py"),
        Path("transport/redis_commands.py"),
    }
    offenders: list[Path] = []
    for path in source_root.rglob("*.py"):
        if path.relative_to(source_root) in allowed:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                names = [alias.name for alias in node.names]
            elif isinstance(node, ast.ImportFrom) and node.module:
                names = [node.module]
            else:
                continue
            if any(name == "redis" or name.startswith("redis.") for name in names):
                offenders.append(path.relative_to(source_root))
                break
    assert offenders == []
