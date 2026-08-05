"""The only worker module allowed to import ``elitea_sdk``.

Configuration behavior is selected from the installed SDK registry captured at
composition time. Validation and connection checking remain distinct explicit
operations; neither reloads the registry or rewrites provider-specific input.
"""

from __future__ import annotations

import hashlib
import importlib
import re
import sys
from contextlib import contextmanager, redirect_stdout
from copy import deepcopy
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from elitea_worker.agents.client_context import EliteaClientContext
from elitea_worker.agents.configuration_registry import (
    ConfigurationRegistryShadow,
    RegistryLoader,
)
from elitea_worker.constants import (
    CONFIGURATION_CATALOG_REVISION,
    CONFIGURATION_CATALOG_SHA256,
    SDK_PACKAGE_TREE_SHA256,
)
from elitea_worker.execution.errors import DependencyUnavailable, UnsupportedCapability
from elitea_worker.handlers.agent import AgentExecutionPayload


_CURRENT_APPLICATION_TOOL_NAME_PATTERN = re.compile(r"[^a-zA-Z0-9_.-]")
_MAX_CURRENT_APPLICATION_TOOL_NAME_BYTES = 128


@dataclass(frozen=True, slots=True)
class SdkValidationError:
    error_type: str
    location: tuple[str | int, ...]
    ordinal: int


@dataclass(frozen=True, slots=True)
class SdkValidationOutcome:
    errors: tuple[SdkValidationError, ...]

    @property
    def valid(self) -> bool:
        return not self.errors


class SdkBudgetExceeded(Exception):
    """Data-free marker for an exact SDK budget policy rejection."""


@dataclass(frozen=True, slots=True)
class SdkConfigurationBinding:
    configuration_type: str
    schema_id: str
    schema_revision: str
    schema_digest: bytes
    validation_supported: bool
    connection_check_supported: bool


class EliteaSdkAdapter:
    """Pinned SDK configuration-model adapter loaded once at composition time."""

    def __init__(self, registry_loader: RegistryLoader | None = None) -> None:
        if registry_loader is None:
            # SDK package initializers discover optional integrations and may
            # print diagnostics. Keep stdout reserved for the worker protocol.
            with redirect_stdout(sys.stderr):
                module = _import_sdk_configurations()
                _require_complete_configuration_registry(module)
                package_root = Path(module.__file__).resolve().parents[1]
                if _package_tree_digest(package_root) != SDK_PACKAGE_TREE_SHA256:
                    raise DependencyUnavailable(
                        "The installed Elitea SDK artifact does not match the admitted package tree."
                    )
                self._registry = ConfigurationRegistryShadow(
                    module.get_class_configurations
                )
        else:
            # Injection is restricted to composition/tests. The shadow still
            # copies and validates the registry exactly once.
            self._registry = ConfigurationRegistryShadow(registry_loader)

    @property
    def catalog_revision(self) -> str:
        return CONFIGURATION_CATALOG_REVISION

    @property
    def catalog_digest(self) -> bytes:
        # This remains the admitted catalog identity used by the current wire.
        # Each selected model is additionally bound to its computed schema
        # digest below, so a type cannot be validated against another schema.
        return bytes.fromhex(CONFIGURATION_CATALOG_SHA256)

    def schema(self, configuration_type: str) -> SdkConfigurationBinding:
        entry = self._registry.entry(configuration_type)
        if entry is None:
            raise UnsupportedCapability("Configuration type is not supported.")
        return SdkConfigurationBinding(
            configuration_type=entry.type,
            schema_id=f"elitea.configuration.{entry.type}",
            schema_revision=CONFIGURATION_CATALOG_REVISION,
            schema_digest=entry.schema_digest,
            validation_supported=entry.validation_supported,
            connection_check_supported=entry.connection_check_supported,
        )

    def validate(self, configuration_type: str, settings: dict[str, Any]) -> SdkValidationOutcome:
        binding = self.schema(configuration_type)
        if not binding.validation_supported:
            raise UnsupportedCapability(
                "Validation is not supported for this configuration type."
            )
        model = self._registry.model(binding.configuration_type)
        if model is None:
            raise UnsupportedCapability("Configuration type is not supported.")

        try:
            # Business-compatibility boundary: exactly the registered SDK
            # validation algorithm, exactly once for each admitted request.
            model.model_validate(settings)
        except ValidationError as exc:
            raw_errors = exc.errors(
                include_url=False,
                include_context=False,
                include_input=False,
            )
            errors = tuple(
                SdkValidationError(
                    error_type=str(item.get("type", "unknown")),
                    location=tuple(item.get("loc", ())),
                    ordinal=index,
                )
                for index, item in enumerate(raw_errors)
            )
            return SdkValidationOutcome(errors)
        return SdkValidationOutcome(())

    def check_connection(
        self,
        configuration_type: str,
        settings: dict[str, Any],
    ) -> str | dict[str, Any] | None:
        """Run a registered checker only for an explicit caller operation."""

        binding = self.schema(configuration_type)
        model = self._registry.model(binding.configuration_type)
        checker = (
            getattr(model, "check_connection", None) if model is not None else None
        )
        if not binding.connection_check_supported or not callable(checker):
            raise UnsupportedCapability(
                "Connection checking is not supported for this configuration type."
            )
        return checker(settings)


class EliteaSdkToolkitAdapter:
    """Pinned adapter for the current ``toolkit.available_tools`` algorithm.

    Evidence boundary:
    - ``centry/pylon_indexer/plugins/indexer_worker/methods/``
      ``indexer_toolkit_available_tools.py:32-39`` delegates to this SDK API
      and maps an escaping ``Exception`` to the current response shape.
    - ``elitea_sdk/tools/__init__.py:368-401`` owns type normalization,
      enumerator lookup, result values and toolkit error strings.

    This adapter deliberately performs one keyword call and no normalization,
    filtering, retry, caching or result rewrite.
    """

    def __init__(self) -> None:
        # Loading elitea_sdk.tools discovers optional toolkit modules and may
        # print import diagnostics. Keep command/result stdout free of those
        # diagnostics without changing the SDK's discovery semantics.
        with redirect_stdout(sys.stderr):
            module = importlib.import_module("elitea_sdk.tools")
        package_root = Path(module.__file__).resolve().parents[1]
        if _package_tree_digest(package_root) != SDK_PACKAGE_TREE_SHA256:
            raise DependencyUnavailable(
                "The installed Elitea SDK artifact does not match the admitted package tree."
            )
        self._tools_module = module

    def get_toolkit_available_tools(
        self,
        toolkit_type: str,
        settings: dict[str, Any],
    ) -> dict[str, Any]:
        # Business-compatibility boundary: this is exactly the call performed
        # by the current indexer wrapper, exactly once per admitted execution.
        return self._tools_module.get_toolkit_available_tools(
            toolkit_type=toolkit_type,
            settings=settings,
        )


def verify_sdk_markdown_runtime(sentinel: str) -> None:
    """Exercise the shared SDK Markdown parser without leaking SDK ownership."""

    with redirect_stdout(sys.stderr):
        module = importlib.import_module("elitea_sdk.tools.utils.content_parser")
    documents = list(
        module.process_content_by_type(
            ("# " + sentinel).encode("utf-8"),
            "elitea-runtime-probe.md",
        )
    )
    observed = "\n".join(document.page_content for document in documents)
    if not documents or sentinel not in observed:
        raise RuntimeError("markdown-output-mismatch")


class EliteaSdkIndexingAdapter:
    """Pinned adapter for the current ``index_data`` SDK entrypoint.

    The authorized runtime composition supplies an initialized ``EliteAClient``.
    Client construction and credential redemption are deliberately outside this
    parity kernel. The adapter preserves the current worker's one public SDK
    call without copying its Pylon event, logging or response-cleaning wrapper.
    """

    def __init__(self, client: Any) -> None:
        client_type = _indexing_client_type()
        if not isinstance(client, client_type):
            raise TypeError(
                "client must be an EliteAClient from the admitted SDK artifact"
            )
        self._client = client

    @classmethod
    def from_context(cls, context: EliteaClientContext) -> EliteaSdkIndexingAdapter:
        """Construct one SDK client from claim-scoped in-memory authority."""

        client_type = _indexing_client_type()
        client = client_type(
            project_id=context.project_id,
            base_url=context.base_url,
            auth_token=context.auth_token,
        )
        return cls(client)

    def ingest(
        self,
        *,
        toolkit_config: dict[str, Any],
        tool_params: dict[str, Any],
        runtime_config: dict[str, Any],
        llm_model: str | None,
        llm_config: dict[str, Any],
        mcp_tokens: dict[str, Any] | None,
    ) -> dict[str, Any]:
        invocation_toolkit_config = _current_index_tool_name_compatibility(
            toolkit_config
        )
        # Business-compatibility boundary: exactly the public SDK operation used
        # by the current indexer worker, exactly once per kernel invocation.
        try:
            return self._client.test_toolkit_tool(
                toolkit_config=invocation_toolkit_config,
                tool_name="index_data",
                tool_params=deepcopy(tool_params),
                runtime_config=runtime_config,
                llm_model=llm_model,
                llm_config=deepcopy(llm_config),
                mcp_tokens=mcp_tokens,
            )
        except Exception as error:
            if _is_sdk_budget_exceeded(error):
                raise SdkBudgetExceeded() from None
            raise


class EliteaSdkAgentAdapter:
    """Initial synchronous SDK seam for the two current agent constructors.

    The admitted kernel accepts ordinary turns and explicit response
    regeneration. Resume/HITL, MCP pause, image resolution and durable children
    remain separate admission gates.
    """

    def __init__(
        self,
        client: Any,
        *,
        memory: Any = None,
        callbacks: list[Any] | None = None,
        checkpoint_factory: Any = None,
        project_id: int | None = None,
    ) -> None:
        client_type = _indexing_client_type()
        if not isinstance(client, client_type):
            raise TypeError(
                "client must be an EliteAClient from the admitted SDK artifact"
            )
        self._client = client
        # The claim-bound composition owns this checkpointer. It is never part
        # of AgentExecutionInputV1 and never crosses Redis or gRPC. The SDK and
        # LangGraph remain the only readers/writers of checkpoint state.
        self._memory = memory
        self._callbacks = list(callbacks or [])
        self._checkpoint_factory = checkpoint_factory
        self._project_id = project_id

    @classmethod
    def from_context(
        cls,
        context: EliteaClientContext,
        *,
        memory: Any = None,
        callbacks: list[Any] | None = None,
        checkpoint_factory: Any = None,
    ) -> EliteaSdkAgentAdapter:
        client_type = _indexing_client_type()
        client = client_type(
            project_id=context.project_id,
            base_url=context.base_url,
            auth_token=context.auth_token,
        )
        return cls(
            client,
            memory=memory,
            callbacks=callbacks,
            checkpoint_factory=checkpoint_factory,
            project_id=context.project_id,
        )

    def execute_application(self, payload: AgentExecutionPayload) -> dict[str, Any]:
        _require_initial_agent_kernel(payload)
        with self._execution_memory() as memory:
            application = payload.application
            version_details = deepcopy(application.get("version_details") or {})
            llm_kwargs = _llm_kwargs(payload.llm)
            executor = self._client.application(
                application_id=application.get("id"),
                application_version_id=application.get("version_id"),
                tools=deepcopy(payload.tools) or None,
                memory=memory,
                application_variables=deepcopy(application.get("variables")),
                version_details=version_details or None,
                mcp_tokens=deepcopy(payload.mcp_tokens),
                conversation_id=payload.conversation_id,
                ignored_mcp_servers=list(payload.ignored_mcp_servers),
                user_declined_mcp_servers=deepcopy(payload.user_declined_mcp_servers),
                exception_handling_enabled=bool(payload.exception_handling_enabled),
                context_settings=deepcopy(payload.context_settings),
                auto_approve_sensitive_actions=payload.auto_approve_sensitive_actions,
                openai_compatible=bool(llm_kwargs.get("openai_compatible", False)),
            )
            return _invoke_initial_agent(
                executor,
                payload,
                version_details.get("meta"),
                self._callbacks,
                memory,
            )

    def execute_adhoc(self, payload: AgentExecutionPayload) -> dict[str, Any]:
        _require_initial_agent_kernel(payload)
        with self._execution_memory() as memory:
            llm_kwargs = _llm_kwargs(payload.llm)
            llm = self._client.get_llm(
                model_name=llm_kwargs.get("model"),
                model_config={
                    "model_project_id": llm_kwargs.get("model_project_id"),
                    "max_tokens": llm_kwargs.get("max_tokens"),
                    "reasoning_effort": llm_kwargs.get("reasoning_effort"),
                    "temperature": llm_kwargs.get("temperature"),
                    "streaming": llm_kwargs.get("stream", True),
                    "openai_compatible": llm_kwargs.get("openai_compatible", False),
                },
            )
            executor = self._client.predict_agent(
                llm=llm,
                instructions=payload.application.get(
                    "instructions", "You are a helpful assistant."
                ),
                tools=deepcopy(payload.tools),
                chat_history=deepcopy(payload.chat_history),
                memory=memory,
                debug_mode=True if payload.debug_mode is None else payload.debug_mode,
                mcp_tokens=deepcopy(payload.mcp_tokens),
                conversation_id=payload.conversation_id,
                ignored_mcp_servers=list(payload.ignored_mcp_servers),
                persona=payload.persona,
                lazy_tools_mode="lazy_tools_mode" in payload.internal_tools,
                internal_tools=list(payload.internal_tools),
                exception_handling_enabled=bool(payload.exception_handling_enabled),
                context_settings=deepcopy(payload.context_settings),
                step_limit=payload.steps_limit,
                auto_approve_sensitive_actions=payload.auto_approve_sensitive_actions,
                user_declined_mcp_servers=deepcopy(payload.user_declined_mcp_servers),
            )
            return _invoke_initial_agent(
                executor,
                payload,
                None,
                self._callbacks,
                memory,
            )

    @contextmanager
    def _execution_memory(self):
        """Keep one saver open for exactly one synchronous SDK invocation."""

        if self._memory is not None:
            yield self._memory
            return
        if self._checkpoint_factory is None or self._project_id is None:
            raise DependencyUnavailable(
                "The durable agent checkpoint store is unavailable."
            )
        with self._checkpoint_factory.open(
            self._client,
            project_id=self._project_id,
        ) as memory:
            yield memory


def _require_initial_agent_kernel(payload: AgentExecutionPayload) -> None:
    """Keep partial behavior unreachable instead of silently drifting."""

    if (
        payload.checkpoint_id
        or payload.should_continue
        or payload.hitl_resume
        or payload.hitl_decisions
        or payload.invoked_skills
        or payload.applied_skills
        or payload.attached_skills
        or payload.input_attachments
        or payload.parallel_reconcile is not None
        or payload.parallel_terminal_errors
    ):
        raise UnsupportedCapability(
            "This agent execution requires a parity path that is not admitted yet."
        )
    if not payload.thread_id and not payload.conversation_id:
        raise UnsupportedCapability(
            "A durable agent thread identity is required for this parity path."
        )


def _llm_kwargs(value: dict[str, Any]) -> dict[str, Any]:
    kwargs = value.get("kwargs")
    if not isinstance(kwargs, dict):
        raise UnsupportedCapability("The agent model settings are malformed.")
    # Authentication and origin come exclusively from EliteaClientContext.
    return {
        key: deepcopy(item)
        for key, item in kwargs.items()
        if key not in {"api_key", "api_extra_headers", "base_url", "deployment"}
    }


def _invoke_initial_agent(
    executor: Any,
    payload: AgentExecutionPayload,
    application_meta: Any,
    callbacks: list[Any],
    memory: Any,
) -> dict[str, Any]:
    from langchain_core.messages import HumanMessage

    messages = deepcopy(payload.chat_history)
    messages.append(HumanMessage(content=deepcopy(payload.user_input)))
    configurable: dict[str, Any] = {
        "thread_id": payload.thread_id or payload.conversation_id,
    }
    invoke_config: dict[str, Any] = {"configurable": configurable}
    if callbacks:
        invoke_config["callbacks"] = list(callbacks)
    if isinstance(application_meta, dict):
        step_limit = application_meta.get("step_limit")
        if isinstance(step_limit, int) and not isinstance(step_limit, bool) and step_limit > 0:
            invoke_config["recursion_limit"] = step_limit
    if payload.is_regenerate:
        _discard_regenerated_thread(memory, invoke_config)
    else:
        _discard_failed_checkpoint(memory, invoke_config)
        _discard_failed_direct_application_checkpoints(
            memory,
            invoke_config,
            payload,
        )
    result = executor.invoke({"messages": messages}, invoke_config)
    if not isinstance(result, dict):
        raise TypeError("the SDK agent invocation returned a non-object result")
    return result


def _discard_failed_checkpoint(memory: Any, config: dict[str, Any]) -> None:
    """Remove only a checkpoint with an explicit failed-task write.

    HITL, MCP/toolkit authorization, static interrupts and other intentional
    pauses do not carry ``__error__`` and remain untouched. Main already sends
    the authoritative persisted chat history for an ordinary next turn, so a
    failed graph task can be rebuilt after its incomplete checkpoint is gone.
    """

    get_tuple = getattr(memory, "get_tuple", None)
    delete_thread = getattr(memory, "delete_thread", None)
    if not callable(get_tuple) or not callable(delete_thread):
        return
    checkpoint = get_tuple(config)
    if checkpoint is None:
        return
    pending_writes = getattr(checkpoint, "pending_writes", ()) or ()
    if not any(
        isinstance(write, (tuple, list))
        and len(write) >= 2
        and write[1] == "__error__"
        for write in pending_writes
    ):
        return
    configurable = config.get("configurable")
    thread_id = (
        configurable.get("thread_id")
        if isinstance(configurable, dict)
        else None
    )
    if not isinstance(thread_id, str) or not thread_id:
        raise DependencyUnavailable(
            "The durable agent checkpoint identity is unavailable."
        )
    delete_thread(thread_id)
    configurable.pop("checkpoint_id", None)


def _discard_failed_direct_application_checkpoints(
    memory: Any,
    config: dict[str, Any],
    payload: AgentExecutionPayload,
) -> None:
    """Repair explicit failures on deterministic direct child threads only.

    The current SDK derives an ordinary direct application checkpoint as
    ``<parent-thread>:<clean-tool-name>``. Parallel children add a call ID and
    deeper descendants require the child application's own immutable snapshot;
    neither identity is guessed here. Intentional interrupts remain protected
    by ``_discard_failed_checkpoint``'s exact ``__error__`` predicate.
    """

    configurable = config.get("configurable")
    thread_id = (
        configurable.get("thread_id")
        if isinstance(configurable, dict)
        else None
    )
    if not isinstance(thread_id, str) or not thread_id:
        return
    for tool_name in _direct_application_tool_names(payload):
        _discard_failed_checkpoint(
            memory,
            {"configurable": {"thread_id": f"{thread_id}:{tool_name}"}},
        )


def _direct_application_tool_names(
    payload: AgentExecutionPayload,
) -> tuple[str, ...]:
    tool_groups: list[Any] = [payload.tools]
    version_details = payload.application.get("version_details")
    if isinstance(version_details, dict):
        tool_groups.append(version_details.get("tools"))

    names: list[str] = []
    seen: set[str] = set()
    for group in tool_groups:
        if not isinstance(group, list):
            continue
        for tool in group:
            if not isinstance(tool, dict) or tool.get("type") != "application":
                continue
            name = tool.get("name")
            if not isinstance(name, str) or not name:
                continue
            cleaned = _CURRENT_APPLICATION_TOOL_NAME_PATTERN.sub("", name).replace(
                ".", "_"
            )
            if (
                not cleaned
                or len(cleaned.encode("utf-8"))
                > _MAX_CURRENT_APPLICATION_TOOL_NAME_BYTES
                or cleaned in seen
            ):
                continue
            seen.add(cleaned)
            names.append(cleaned)
    return tuple(names)


def _discard_regenerated_thread(memory: Any, config: dict[str, Any]) -> None:
    """Start explicit regeneration from Main's truncated durable history.

    Regeneration intentionally time-travels to the original question while
    reusing the browser response UUID. A checkpoint on the stable conversation
    thread may contain later turns or a paused graph, so it cannot be merged
    into that replacement run.
    """

    delete_thread = getattr(memory, "delete_thread", None)
    if not callable(delete_thread):
        raise DependencyUnavailable(
            "The durable agent checkpoint store cannot reset a regenerated thread."
        )
    configurable = config.get("configurable")
    thread_id = (
        configurable.get("thread_id")
        if isinstance(configurable, dict)
        else None
    )
    if not isinstance(thread_id, str) or not thread_id:
        raise DependencyUnavailable(
            "The durable agent checkpoint identity is unavailable."
        )
    delete_thread(thread_id)
    configurable.pop("checkpoint_id", None)


def _current_index_tool_name_compatibility(
    toolkit_config: dict[str, Any],
) -> dict[str, Any]:
    """Apply the current R-2.0.5 index-tool rename on an invocation-only copy."""

    result = deepcopy(toolkit_config)
    settings = result.get("settings")
    if not isinstance(settings, dict):
        return result
    selected_tools = settings.get("selected_tools")
    if not isinstance(selected_tools, list) or "list_collections" not in selected_tools:
        return result
    migrated = list(selected_tools)
    migrated.remove("list_collections")
    if "list_indexes" not in migrated:
        migrated.append("list_indexes")
    settings["selected_tools"] = migrated
    return result


def _is_sdk_budget_exceeded(error: Exception) -> bool:
    """Match only the admitted SDK's typed budget exception."""

    try:
        module = importlib.import_module("elitea_sdk.runtime.exceptions")
    except ImportError:
        return False
    error_type = getattr(module, "BudgetExceededError", None)
    return isinstance(error_type, type) and isinstance(error, error_type)


def _package_tree_digest(root: Path) -> str:
    digest = hashlib.sha256()
    paths = sorted(root.rglob("*.py"))
    for path in paths:
        relative = path.relative_to(root).as_posix().encode("utf-8")
        content = path.read_bytes()
        digest.update(len(relative).to_bytes(4, "big"))
        digest.update(relative)
        digest.update(len(content).to_bytes(8, "big"))
        digest.update(content)
    return digest.hexdigest()


def _require_complete_configuration_registry(module: Any) -> None:
    """Reject an SDK registry whose guarded imports were incomplete."""

    failed_imports = getattr(module, "FAILED_IMPORTS", None)
    if not isinstance(failed_imports, dict) or failed_imports:
        raise DependencyUnavailable(
            "The installed Elitea SDK configuration registry is incomplete."
        )


def _import_sdk_configurations() -> Any:
    """Load the current SDK registries in their only complete import order.

    SDK 0.8.26's GitHub configuration imports ``elitea_sdk.tools.utils``.
    Importing Configurations first therefore initializes the Tools package
    while the GitHub configuration module is only partially defined, and the
    SDK permanently records GitHub as a failed tool in that process. Loading
    Tools first lets the same SDK finish both registries without changing any
    provider behavior. Remove this ordering shim after the SDK breaks that
    package-initializer cycle.
    """

    importlib.import_module("elitea_sdk.tools")
    return importlib.import_module("elitea_sdk.configurations")


@lru_cache(maxsize=1)
def _indexing_client_type() -> type[Any]:
    with redirect_stdout(sys.stderr):
        module = importlib.import_module("elitea_sdk.runtime.clients.client")
    package_root = Path(module.__file__).resolve().parents[2]
    if _package_tree_digest(package_root) != SDK_PACKAGE_TREE_SHA256:
        raise DependencyUnavailable(
            "The installed Elitea SDK artifact does not match the admitted package tree."
        )
    return module.EliteAClient
