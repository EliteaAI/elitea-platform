"""End-to-end: drive the ported SPI, engine wired, against a real repository.

Proves the port EXECUTES — clone, index, repository analysis, structure
planning, page generation, artifact composition — and that the composed result
carries the frozen object set. It is not a content test: the LLM is a local
stub (``llm_stub.py``) whose answers are canned and deterministic. What is
under test is the pipeline, not the prose.

Not wired into CI: it needs the ~1.1 GB engine extra and a local git daemon.
See e2e/README.md for the setup.

    python e2e/run_generate_wiki.py <scratch-dir>

Environment:
    E2E_TIMEOUT   seconds to wait for the invocation (default 600)
    E2E_DUMP      path to write the result objects as JSON
"""
import asyncio, json, os, pathlib, sys, warnings
warnings.filterwarnings("ignore")

os.environ.setdefault("ELITEA_DEEPWIKI_RUNNER", "legacy")
os.environ.setdefault("ELITEA_DEEPWIKI_SCRATCH_PATH", sys.argv[1])
# The egress allowlist is FAIL-CLOSED: unset refuses every clone. The harness
# clones from the local git daemon, so that host is what it permits.
os.environ.setdefault("ELITEA_DEEPWIKI_GIT_ALLOWLIST", "127.0.0.1")

os.environ["GIT_CONFIG_COUNT"] = "1"
# git daemon, not dumb HTTP: the engine clones with --depth, and dumb HTTP
# transport does not support shallow capabilities. insteadOf can rewrite the
# scheme as well as the host, and this is process-scoped — no global git config
# is touched.
os.environ["GIT_CONFIG_KEY_0"] = "url.git://127.0.0.1:19418/.insteadOf"
os.environ["GIT_CONFIG_VALUE_0"] = "https://127.0.0.1:18900/"

from httpx import ASGITransport, AsyncClient
from elitea_deepwiki.app import create_app
from elitea_deepwiki.config import Settings

MOCK = "http://127.0.0.1:18901/v1"

REQUEST = {
    "configuration": {"parameters": {
        # repository/active_branch sit at the TOOLKIT level, not inside
        # github_configuration: _extract_repo_config_from_toolkit reads them
        # off the merged toolkit payload. Putting them only in the provider
        # block yields repo_config["repository"] = None and the engine refuses
        # with "GitHub repository not specified".
        "code_toolkit": {
            # GitHub reads base_url; GitLab reads url. Not interchangeable.
            "github_configuration": {"base_url": "http://127.0.0.1:18900"},
            "repository": "acme/notes-service",
            "active_branch": "main",
        },
        "llm_settings": {
            # Both spellings on purpose: the in-process path requires
            # openai_api_*, the subprocess worker accepts either.
            "model_name": "gpt-4o",
            "api_base": MOCK, "api_key": "mock",
            "openai_api_base": MOCK, "openai_api_key": "mock",
            "organization": "1", "max_tokens": 4000,
        },
        # A STRING, despite the descriptor declaring this parameter as JSON:
        # the engine passes it straight to OpenAIEmbeddings(model=...).
        "embedding_model": "text-embedding-3-small",
    }},
    "parameters": {"query": "Document the notes service", "planner_type": "cluster",
        "run_in_subprocess": True},
}


async def main():
    settings = Settings.from_env()
    app = create_app(settings=settings)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://dw.test") as http:
        async with app.router.lifespan_context(app):
            health = (await http.get("/health")).json()
            print("runner:", health["extra_info"]["runner"])

            accepted = await http.post("/tools/Wikis/generate_wiki/invoke", json=REQUEST)
            iid = accepted.json()["invocation_id"]
            print("accepted:", iid)

            url = f"/tools/Wikis/generate_wiki/invocations/{iid}"
            deadline = asyncio.get_running_loop().time() + float(os.environ.get("E2E_TIMEOUT", "600"))
            body = {}
            while asyncio.get_running_loop().time() < deadline:
                body = (await http.get(url)).json()
                for ev in body.get("custom_events", []):
                    print("  event:", ev["data"]["message"][:150])
                if body.get("status") not in ("Started", "InProgress"):
                    break
                await asyncio.sleep(1.0)

            print("terminal status:", body.get("status"))
            print("category:", body.get("error_category"))
            objects = json.loads(body.get("result", "[]"))
            print(f"result objects: {len(objects)}")
            for o in objects:
                print("  ", o.get("object_type"), "|", (o.get("name") or "")[:70],
                      "|", len(o.get("data") or ""), "bytes")
            out = pathlib.Path(os.environ.get("E2E_DUMP", "")) if os.environ.get("E2E_DUMP") else None
            if out:
                out.write_text(json.dumps(objects, indent=1))
                print("dumped result objects to", out)
            if body.get("status") == "Error" and objects:
                print("\nERROR MESSAGE:\n", objects[0]["data"][:3000])

asyncio.run(main())
