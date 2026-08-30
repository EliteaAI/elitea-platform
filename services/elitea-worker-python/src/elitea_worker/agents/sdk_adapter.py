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
import threading
from contextlib import contextmanager, redirect_stdout
from copy import deepcopy
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from elitea_worker.agents.attachments import (
    ATTACHMENT_READ_TOOL_NAME,
    ATTACHMENT_TOOLKIT_NAME,
    ATTACHMENT_TOOLKIT_TYPE,
    AttachmentContentWriteback,
    attachment_content_writebacks,
    attachment_message_chunks,
    human_message_content,
    pending_attachment_reads,
    report_failed_attachment_reads,
)
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
_NEXT_INPUT_SUGGESTION_PROMPT = (
    "You suggest a likely next user message in a chat, based on the "
    "assistant's latest reply. Reply with ONLY the suggested next user "
    "message, or the single word NONE if the reply doesn't make one "
    "obvious (e.g. a greeting, a simple acknowledgement, or a final "
    "answer with no natural follow-up). Keep it short — one sentence, "
    "written as if the user typed it.\n\n"
    "Examples:\n"
    "Assistant: Hi! How can I help you today?\n"
    "Suggestion: NONE\n\n"
    "Assistant: I've fixed the bug. Want me to also add a test for it?\n"
    "Suggestion: Yes, please add a test.\n\n"
    "Assistant: The capital of France is Paris.\n"
    "Suggestion: NONE\n\n"
    "Assistant reply:\n{reply}\n\nSuggestion:"
)


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


@contextmanager
def _sdk_budget_boundary() -> Any:
    """Turn the SDK's typed budget rejection into the worker's marker.

    A budget rejection is a POLICY outcome, not a fault. The SDK raises
    ``BudgetExceededError`` for it and states why it must never be swallowed:
    there is no recovery from an exhausted budget, so continuing would feed a
    policy rejection back into the model as if it were data.

    Every SDK entry point this adapter owns needs the boundary, not only the
    indexing one. Agent execution had no boundary, so an exhausted budget
    reached the delivery catch-all as an unclassified exception and was
    reported as ``InternalFailure`` — a retryable internal fault, for a
    condition that no retry can clear.

    The marker carries no message. The SDK's text names the budget and can
    quote the proxy; the worker's public diagnostics stay data-free.
    """

    try:
        yield
    except Exception as error:
        if _is_sdk_budget_exceeded(error):
            raise SdkBudgetExceeded() from None
        raise


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
        with _sdk_budget_boundary():
            return self._client.test_toolkit_tool(
                toolkit_config=invocation_toolkit_config,
                tool_name="index_data",
                tool_params=deepcopy(tool_params),
                runtime_config=runtime_config,
                llm_model=llm_model,
                llm_config=deepcopy(llm_config),
                mcp_tokens=mcp_tokens,
            )


class EliteaSdkAgentAdapter:
    """Initial synchronous SDK seam for the two current agent constructors.

    The admitted kernel accepts ordinary turns, explicit response regeneration,
    root HITL, and delegated-toolkit authorization continuation. Image
    resolution and unbounded durable children remain deferred.
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
        # #607: what this turn's document reads produced, kept so the terminal
        # result can report it back for persistence. One adapter is built per
        # execution, so this is turn-scoped state and not a cache.
        self._attachment_writebacks: list[AttachmentContentWriteback] = []

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
        _apply_toolkit_guardrails(payload)
        with self._execution_memory() as memory, _sdk_budget_boundary():
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
                self._read_attachment_documents,
            )

    def execute_adhoc(self, payload: AgentExecutionPayload) -> dict[str, Any]:
        _require_initial_agent_kernel(payload)
        _apply_toolkit_guardrails(payload)
        with self._execution_memory() as memory, _sdk_budget_boundary():
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
                self._read_attachment_documents,
            )

    def suggest_next_input(
        self,
        payload: AgentExecutionPayload,
        *,
        output_text: str,
    ) -> str | None:
        """Generate the current best-effort post-response suggestion."""

        try:
            policy = payload.next_input_suggestion
            if not policy.get("enabled"):
                return None
            if len(output_text) < policy["min_response_chars"]:
                return None

            llm = self._client.get_low_tier_llm(max_tokens=64)
            if llm is None:
                return None

            result: list[Any] = []

            def invoke() -> None:
                try:
                    result.append(
                        llm.invoke(
                            _NEXT_INPUT_SUGGESTION_PROMPT.format(reply=output_text)
                        )
                    )
                except Exception:
                    return

            thread = threading.Thread(target=invoke, daemon=True)
            thread.start()
            thread.join(timeout=policy["timeout_seconds"])
            if thread.is_alive() or not result:
                return None

            suggestion = getattr(result[0], "content", result[0])
            text = str(suggestion or "").strip()
            if not text or text.upper() == "NONE":
                return None
            return text
        except Exception:
            # Exact current behavior: this optional follow-up cannot fail an
            # otherwise successful primary execution.
            return None

    def _read_attachment_documents(
        self,
        payload: AgentExecutionPayload,
        references: list[tuple[str, str]],
    ) -> dict[tuple[str, str], str]:
        """Read this turn's attached documents through the SDK artifact toolkit.

        This is pylon's extraction step (rpc/chat_all.py:344-377 →
        utils/attachments.py:429-497) with its Pylon transport removed. Pylon
        goes through ``test_toolkit_tool_sio`` because its reader lives in
        another process; the worker IS that process, so it makes the same
        public SDK call the indexing adapter already makes
        (``EliteaSdkIndexingAdapter.ingest``) — one batched
        ``read_multiple_files`` per bucket, on the claim-scoped client.

        ONE CALL PER BUCKET, not one per file. Pylon batches too, and it can
        assume a single bucket because it resolves the project default itself
        (utils/internal_tools.py:277-295). The worker takes the bucket from
        each chunk's marker instead — it has no vault access — so files from
        two buckets in one turn cost two calls rather than being silently read
        from the wrong one.

        NOTHING HERE MAY FAIL THE TURN. A bucket the platform cannot read, a
        toolkit that will not instantiate, a file that no longer exists —
        pylon logs each and continues (rpc/chat_all.py:384-386), because the
        question may not even be about the file, and the header chunk still
        tells the model the file exists and that read tools are available. The
        single exception is a budget rejection: it is a policy outcome with no
        recovery, and swallowing it here would only let the agent invocation
        hit the same wall a moment later with the attachment silently dropped.
        """

        contents: dict[tuple[str, str], str] = {}
        failures = 0
        by_bucket: dict[str, list[str]] = {}
        for bucket, name in references:
            by_bucket.setdefault(bucket, []).append(name)
        for bucket, names in by_bucket.items():
            try:
                outcome = self._client.test_toolkit_tool(
                    toolkit_config={
                        "type": ATTACHMENT_TOOLKIT_TYPE,
                        "toolkit_name": ATTACHMENT_TOOLKIT_NAME,
                        # Auto-injected, no toolkit entity in the database —
                        # exactly as pylon builds it
                        # (utils/attachments.py:454-461).
                        "toolkit_id": None,
                        "settings": {"bucket": bucket},
                    },
                    tool_name=ATTACHMENT_READ_TOOL_NAME,
                    tool_params={"file_paths": list(names)},
                    # The turn's own model, so the toolkit is built against the
                    # model this turn is already authorized for rather than the
                    # SDK's 'gpt-4o-mini' default, which a deployment need not
                    # serve. The read tool never calls it: the LLM is only an
                    # argument of toolkit instantiation.
                    llm_model=_llm_kwargs(payload.llm).get("model"),
                )
            except Exception as error:
                if _is_sdk_budget_exceeded(error):
                    raise
                failures += len(names)
                continue
            files = outcome.get("result") if isinstance(outcome, dict) else None
            # `success: False` is RETURNED, not raised, for a toolkit or tool
            # failure (SDK client.test_toolkit_tool), so an unchecked
            # `.get("result")` would forward a refusal's payload as if it were
            # the file's contents.
            if (
                not isinstance(outcome, dict)
                or not outcome.get("success")
                or not isinstance(files, dict)
            ):
                failures += len(names)
                continue
            for name in names:
                text = files.get(name)
                # A per-file read error arrives as its own string
                # ("Error reading file: ...", SDK elitea_base.py:685-687) and
                # pylon forwards it to the model unchanged: it is a truthful
                # answer to "what is in this file". Only an absent or empty
                # entry counts as a failure.
                if isinstance(text, str) and text:
                    contents[(bucket, name)] = text
                else:
                    failures += 1
        report_failed_attachment_reads(failures)
        # Composed here rather than in the caller because this is the only
        # place that knows which reads succeeded. A file that could not be read
        # contributes nothing: it has no text to persist, and leaving its row
        # untouched is what lets a later turn try again.
        self._attachment_writebacks = attachment_content_writebacks(
            payload.input_attachments,
            contents,
        )
        return contents

    @property
    def attachment_content_writebacks(self) -> list[AttachmentContentWriteback]:
        """The enriched attachment rows this turn produced, if any (#607)."""

        return list(self._attachment_writebacks)

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


def _apply_toolkit_guardrails(payload: AgentExecutionPayload) -> None:
    """Configure the SDK's guardrail state from the policy this run carries.

    ## Why this is per run and not per container

    ``elitea_sdk.runtime.toolkits.security`` keeps its blocklist and its
    sensitive-tool policy in module-level globals, and until now the only thing
    that ever populated them was ``ELITEA_SENSITIVE_TOOLS`` and its siblings,
    read lazily from the environment on first use. That means a policy change
    needs a redeploy, and every tenant sharing a worker pool shares one answer.
    The admin Configuration page writes this policy per platform and expects it
    to take effect on the next call, so the resolved policy travels with the
    command and is applied here, immediately before the agent is built.

    ``configure_blocklist`` and ``configure_sensitive_tools`` are public SDK
    functions that had no non-test caller. This is that caller.

    ## Absent means "leave the environment alone"

    A command with no policy — an older platform, or a replayed command — must
    not clear a blocklist the environment configured. Both SDK functions set an
    ``_initialized`` flag as a side effect, so calling them with empty arguments
    would permanently suppress the environment fallback for the life of the
    process. ``None`` therefore returns without touching anything, and only an
    explicit policy object configures.

    ## Failure is not swallowed

    An exception here means the SDK's guardrail API is not the shape this worker
    was written against. Continuing would run the agent with whatever policy the
    globals last held — which, on a shared worker, is the previous run's. That is
    worse than refusing the command.
    """

    policy = payload.toolkit_guardrails
    if policy is None:
        return

    security = importlib.import_module("elitea_sdk.runtime.toolkits.security")
    security.configure_blocklist(
        blocked_toolkits=list(policy.get("blocked_toolkits") or []),
        blocked_tools=dict(policy.get("blocked_tools") or {}),
    )
    security.configure_sensitive_tools(
        sensitive_tools=dict(policy.get("sensitive_tools") or {}),
        # Empty string, not None: the SDK treats a falsy value as "use my
        # default", and the platform already substituted its own defaults when
        # the operator left the field blank. Passing the resolved value through
        # keeps one source of truth for the dialog copy.
        company_name=policy.get("sensitive_action_company_name") or None,
        message_template=policy.get("sensitive_action_message_template") or None,
    )


def _require_initial_agent_kernel(payload: AgentExecutionPayload) -> None:
    """Keep partial behavior unreachable instead of silently drifting."""

    hitl_resume = payload.hitl_resume or bool(payload.hitl_decisions)
    authorization_resume = _is_authorization_resume(payload)
    # #606: input_attachments is no longer one of these. It was refused here
    # because nothing consumed it, so a turn carrying a file would silently
    # have answered without it — a refusal was the honest outcome. It now has
    # a consumer: the chunks are spliced into the human message and documents
    # are read through the SDK artifact toolkit
    # (_invoke_initial_agent / agents/attachments.py), which is pylon's own
    # behaviour (utils/chat_history.py:67-73, rpc/chat_all.py:344-377). The
    # other three disjuncts keep refusing: each still names a path with no
    # implementation behind it.
    if (
        payload.checkpoint_id
        or payload.parallel_reconcile is not None
        or payload.parallel_terminal_errors
    ):
        raise UnsupportedCapability(
            "This agent execution requires a parity path that is not admitted yet."
        )
    if hitl_resume:
        _require_in_process_hitl_resume(payload)
    elif authorization_resume:
        _require_authorization_resume(payload)
    elif payload.should_continue:
        raise UnsupportedCapability(
            "This agent execution requires a parity path that is not admitted yet."
        )
    if not payload.thread_id and not payload.conversation_id:
        raise UnsupportedCapability(
            "A durable agent thread identity is required for this parity path."
        )


def _is_authorization_resume(payload: AgentExecutionPayload) -> bool:
    """Identify an explicit authorization decision on an agent capability."""

    return bool(
        payload.should_continue
        and not payload.hitl_resume
        and not payload.hitl_decisions
        and (payload.mcp_tokens or payload.user_declined_mcp_servers)
    )


def _require_authorization_resume(payload: AgentExecutionPayload) -> None:
    """Admit only an explicit delegated-toolkit authorize or skip resume."""

    if (
        payload.hitl_resume
        or payload.hitl_decisions
        or payload.hitl_action is not None
        or payload.hitl_value is not None
    ):
        raise UnsupportedCapability(
            "Toolkit authorization continuation cannot contain a HITL decision."
        )
    if not payload.mcp_tokens and not payload.user_declined_mcp_servers:
        raise UnsupportedCapability(
            "Toolkit authorization continuation requires an authorization or skip decision."
        )
    for declined in payload.user_declined_mcp_servers:
        if not isinstance(declined, dict):
            raise UnsupportedCapability(
                "The declined toolkit authorization decision is malformed."
            )
        server_url = declined.get("server_url")
        if not isinstance(server_url, str) or not server_url.strip():
            raise UnsupportedCapability(
                "The declined toolkit authorization server identity is required."
            )


def _require_in_process_hitl_resume(payload: AgentExecutionPayload) -> None:
    """Admit one atomic set of public, checkpoint-bound HITL decisions."""

    if not payload.hitl_resume:
        raise UnsupportedCapability("The HITL resume marker is required.")
    if not payload.should_continue:
        raise UnsupportedCapability("The HITL continuation marker is required.")
    if not 1 <= len(payload.hitl_decisions) <= 16:
        raise UnsupportedCapability(
            "Between one and sixteen HITL decisions are supported in one continuation."
        )
    if len(payload.hitl_decisions) == 1:
        decision = payload.hitl_decisions[0]
        if not isinstance(decision, dict):
            raise UnsupportedCapability("The HITL decision is malformed.")
        if payload.hitl_action != decision.get("action"):
            raise UnsupportedCapability("The HITL decision action is inconsistent.")
        decision_value = decision.get("value", "")
        if payload.hitl_value not in (None, decision_value):
            raise UnsupportedCapability("The HITL decision value is inconsistent.")
    elif payload.hitl_action is not None or payload.hitl_value is not None:
        raise UnsupportedCapability(
            "Parallel HITL decisions cannot contain a scalar HITL decision."
        )

    seen_interrupts: set[str] = set()
    allowed_keys = {
        "interrupt_id",
        "tool_call_id",
        "guardrail_type",
        "action",
        "value",
    }
    for decision in payload.hitl_decisions:
        if not isinstance(decision, dict) or set(decision) - allowed_keys:
            raise UnsupportedCapability("The HITL decision is malformed.")
        interrupt_id = decision.get("interrupt_id")
        if (
            not isinstance(interrupt_id, str)
            or not interrupt_id.strip()
            or interrupt_id in seen_interrupts
        ):
            raise UnsupportedCapability(
                "Each HITL decision requires one unique interrupt identity."
            )
        seen_interrupts.add(interrupt_id)
        tool_call_id = decision.get("tool_call_id")
        if tool_call_id is not None and not isinstance(tool_call_id, str):
            raise UnsupportedCapability("The HITL tool-call identity is malformed.")
        guardrail_type = decision.get("guardrail_type")
        if guardrail_type not in {None, "mcp_auth"}:
            raise UnsupportedCapability("The HITL guardrail type is not supported.")
        action = decision.get("action")
        allowed_actions = (
            {"authorize", "skip"}
            if guardrail_type == "mcp_auth"
            else {"approve", "reject", "edit", "block_with_comment"}
        )
        if action not in allowed_actions:
            raise UnsupportedCapability("The HITL action is not supported.")
        value = decision.get("value", "")
        if not isinstance(value, str):
            raise UnsupportedCapability("The HITL decision value is malformed.")
        if (
            guardrail_type != "mcp_auth"
            and action in {"edit", "block_with_comment"}
            and not value
        ):
            raise UnsupportedCapability("The HITL decision value is required.")
        if (
            guardrail_type == "mcp_auth"
            or action not in {"edit", "block_with_comment"}
        ) and value:
            raise UnsupportedCapability("The HITL decision value is not allowed.")


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
    attachment_reader: Any = None,
) -> dict[str, Any]:
    from langchain_core.messages import HumanMessage

    messages = deepcopy(payload.chat_history)
    user_message_content = (
        payload.hitl_value
        if payload.hitl_resume
        and payload.hitl_action == "edit"
        and payload.hitl_value is not None
        else payload.user_input
    )
    # #606: the turn's own attachments, spliced in after the user's content.
    #
    # Pylon does not send attachments as a separate field at all — it stores
    # each one as a message item whose chunks the history projection FLATTENS
    # into the message content list (utils/chat_history.py:67-73). The
    # equivalent here is one content list: the user's text first, then the
    # attachment chunks, which is the order the model reads them in.
    #
    # ``payload`` is not mutated. It is the frozen projection of an immutable
    # input binding, and a retried or resumed command must rebuild the same
    # message from the same bytes rather than from whatever a previous attempt
    # spliced into it.
    attachment_chunks: list[Any] = []
    if payload.input_attachments:
        extracted: dict[tuple[str, str], str] = {}
        pending = pending_attachment_reads(payload.input_attachments)
        if pending and attachment_reader is not None:
            extracted = attachment_reader(payload, pending)
        attachment_chunks = attachment_message_chunks(
            payload.input_attachments,
            extracted,
        )
    messages.append(
        HumanMessage(
            content=human_message_content(user_message_content, attachment_chunks)
        )
    )
    configurable: dict[str, Any] = {
        "thread_id": payload.thread_id or payload.conversation_id,
        "invoked_skills": deepcopy(payload.invoked_skills),
        "attached_skills": deepcopy(payload.attached_skills),
    }
    invoke_config: dict[str, Any] = {"configurable": configurable}
    if callbacks:
        invoke_config["callbacks"] = list(callbacks)
    if isinstance(application_meta, dict):
        step_limit = application_meta.get("step_limit")
        if isinstance(step_limit, int) and not isinstance(step_limit, bool) and step_limit > 0:
            invoke_config["recursion_limit"] = step_limit
    authorization_resume = _is_authorization_resume(payload)
    if payload.hitl_resume:
        invoke_input: dict[str, Any] = {
            "messages": messages,
            "hitl_resume": True,
            "hitl_action": payload.hitl_action,
            "hitl_value": payload.hitl_value or "",
            "hitl_decisions": deepcopy(payload.hitl_decisions),
        }
    else:
        invoke_input = {"messages": messages}
    if authorization_resume:
        invoke_input, invoke_config = _configure_authorization_checkpoint_resume(
            executor,
            payload,
            invoke_input,
            invoke_config,
        )
    if payload.is_regenerate:
        _discard_regenerated_thread(memory, invoke_config)
    elif not payload.hitl_resume and not authorization_resume:
        _discard_failed_checkpoint(memory, invoke_config)
        _discard_failed_direct_application_checkpoints(
            memory,
            invoke_config,
            payload,
        )
    result = executor.invoke(invoke_input, invoke_config)
    if not isinstance(result, dict):
        raise TypeError("the SDK agent invocation returned a non-object result")
    for callback in callbacks:
        pause_result = getattr(callback, "authorization_pause_result", None)
        if not callable(pause_result):
            continue
        paused = pause_result()
        if paused is not None:
            return paused
    return result


def _configure_authorization_checkpoint_resume(
    executor: Any,
    payload: AgentExecutionPayload,
    invoke_input: dict[str, Any],
    invoke_config: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Replan the root graph after delegated authorization stopped execution.

    This is the current ``configure_checkpoint_resume`` behavior owned by the
    worker boundary. The SDK reports delegated authorization by bubbling an
    exception; it does not create a LangGraph ``interrupt()`` payload. Find
    only the latest pending root checkpoint, bind it to the invocation, and
    tell the root LLM whether authorization completed or was declined. This
    may create a new nested child invocation and therefore must not be
    described as exact-child resume. No transport or credential value is
    persisted here.
    """

    get_state_history = getattr(executor, "get_state_history", None)
    if not callable(get_state_history):
        raise DependencyUnavailable(
            "The delegated toolkit authorization checkpoint is unavailable."
        )
    states = list(
        get_state_history(
            {"configurable": {"thread_id": payload.thread_id or payload.conversation_id}}
        )
    )
    # Match the current worker: only the latest pending root state may be used
    # for reconstruction. Never time-travel behind a newer completed or failed
    # checkpoint.
    paused = states[0] if states and getattr(states[0], "next", ()) else None
    if paused is None:
        return invoke_input, invoke_config
    state_config = getattr(paused, "config", None)
    configurable = (
        state_config.get("configurable") if isinstance(state_config, dict) else None
    )
    checkpoint_id = (
        configurable.get("checkpoint_id") if isinstance(configurable, dict) else None
    )
    if not isinstance(checkpoint_id, str) or not checkpoint_id:
        raise DependencyUnavailable(
            "The delegated toolkit authorization checkpoint identity is unavailable."
        )

    declined = payload.user_declined_mcp_servers
    if declined and not payload.mcp_tokens:
        details: list[str] = []
        for item in declined:
            reason = item.get("skip_reason") or item.get("denial_reason") or ""
            server_url = item.get("server_url") or ""
            if isinstance(reason, str) and reason.strip():
                details.append(
                    f"{server_url.strip()}: {reason.strip()}"
                    if isinstance(server_url, str) and server_url.strip()
                    else reason.strip()
                )
        reason_text = "; ".join(details)
        continuation = "The user declined toolkit authorization for this session."
        if reason_text:
            continuation += f" Reason: {reason_text}."
        continuation += (
            " Please proceed with the original request without using the unavailable "
            "tools, or explain that you cannot complete it without them."
        )
    else:
        continuation = (
            "The required toolkit authorization has been completed. Please proceed "
            "with the original request using the newly available tools."
        )
    if isinstance(payload.user_input, str) and payload.user_input:
        continuation += f" Original request: {payload.user_input}"

    invoke_config["configurable"]["checkpoint_id"] = checkpoint_id
    invoke_config["should_continue"] = True
    return {"input": continuation}, invoke_config


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
