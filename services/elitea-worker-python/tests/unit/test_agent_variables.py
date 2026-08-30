"""Agent variables reach the model only if Main's projection carries them.

## What was broken, and where

An agent whose instructions say ``Answer only about {{topic}}`` reached the
model with the placeholder intact on this worker, whatever the author saved.
The cause was not in this service: ``application_version_details_json``
(``services/elitea-main/internal/db/queries/agent_chat.sql``) built
``'variables', '[]'::jsonb`` unconditionally, and that key is the ONLY source
the SDK can read here.

The SDK has two sources and the second one cannot substitute for the first:

* ``data['variables']`` -- a LIST of ``{name, value}`` rows -- is captured into
  ``prompt_variables`` (``assistant.py:557-576``), and ``_resolve_jinja2_variables``
  (``:597-657``) renders ``instructions`` through Jinja2 with that map;
* ``meta['variables']`` is folded in afterwards, but ONLY behind
  ``isinstance(meta['variables'], dict)`` (``:574``) -- and this platform stores
  the authored rows as an ARRAY in ``application_versions.meta``, so that
  branch never runs against real data.

So the fix had to fill ``data['variables']``, and these tests are what says the
PINNED SDK is satisfied by that alone -- no third cherry-picked patch on top of
``elitea-sdk.lock.json``'s two.

## Why these run the real SDK rather than restate it

A test that re-implemented the capture rule would agree with itself and prove
nothing about the wheel this image installs. ``Assistant.__init__`` performs the
capture, and its only unmet dependencies for a toolless agent are two attributes
the logging line at ``:580-583`` reads off the LLM client, so the real class can
be constructed here. The rendered string these tests read is therefore produced
by the SDK's own ``SandboxedEnvironment(undefined=DebugUndefined)``.

The companion assertion on the SQL side is
``TestPostgresApplicationVersionDetailsCarryTheAuthoredVariables``
(``services/elitea-main/internal/infra/db/repos``); the browser journey that
holds the two together is ``apps/elitea-web/e2e/streaming/chat.variables.spec.ts``.
"""

from __future__ import annotations

from typing import Any

import pytest

from elitea_sdk.runtime.langchain.assistant import Assistant

from elitea_worker.agents import sdk_adapter


INSTRUCTIONS = "Answer only about {{topic}}."
VALUE = "the release notes"


class StubLlm:
    """Only what ``Assistant.__init__``'s final logging line reads."""

    temperature = 0.1
    max_tokens = 100


def version_details(**overrides: Any) -> dict[str, Any]:
    """One row of `application_version_details_json`, key for key.

    Every key here is one the projection emits; nothing is invented for the
    test. ``variables`` carries what the projection now reads out of
    ``meta.variables``, which is where the HTTP write folds it
    (``internal/api/v2/applications/handler.go``).
    """

    authored = [{"name": "topic", "value": VALUE}]
    document: dict[str, Any] = {
        "id": 2,
        "application_id": 1,
        "name": "base",
        "status": "draft",
        "created_at": "2026-08-29T00:00:00",
        "agent_type": "agent",
        "instructions": INSTRUCTIONS,
        "welcome_message": "",
        "llm_settings": {"model_name": "E2E-MOCK-MODEL"},
        "meta": {"step_limit": 25, "variables": authored},
        "conversation_starters": [],
        "pipeline_settings": {},
        "author_id": 11,
        "tools": [],
        "skills": [],
        "tags": [],
        "variables": authored,
    }
    document.update(overrides)
    return document


def rendered_prompt(document: dict[str, Any]) -> tuple[dict[str, Any], str]:
    assistant = Assistant(StubLlm(), document, StubLlm(), app_type="agent", tools=[])
    return assistant.prompt_variables, assistant._resolve_jinja2_variables(
        assistant.prompt
    )


class TestTheProjectionTheSdkActuallyReads:
    def test_a_populated_variables_list_is_substituted(self) -> None:
        captured, prompt = rendered_prompt(version_details())

        assert captured == {"topic": VALUE}
        assert prompt == f"Answer only about {VALUE}."

    def test_the_old_empty_list_left_the_placeholder_standing(self) -> None:
        """The defect, pinned as a negative control.

        This is exactly what the projection used to emit: `meta` still carries
        the authored rows -- the user's save was never lost -- and the SDK still
        substitutes nothing, because the array spelling misses its
        `isinstance(..., dict)` guard. `{{ topic }}` with SPACES is Jinja2's
        `DebugUndefined` printing the name back in its own canonical spacing, so
        this also distinguishes "rendered with the name undefined" from "never
        rendered at all" (which would keep the unspaced source spelling).
        """

        captured, prompt = rendered_prompt(version_details(variables=[]))

        assert captured == {}
        assert prompt == "Answer only about {{ topic }}."

    def test_the_dict_spelling_still_works_through_meta(self) -> None:
        """Why the projection type-gates on `array` instead of unwrapping.

        A `meta.variables` written as an OBJECT is left out of the `variables`
        key on purpose: it is not the `{name, value}` list shape this branch
        reads, and the SDK reaches that spelling on its own through `meta`,
        which the projection already carries. Filling `variables` must not cost
        that path.
        """

        captured, prompt = rendered_prompt(
            version_details(
                variables=[],
                meta={"step_limit": 25, "variables": {"topic": VALUE}},
            )
        )

        assert captured == {"topic": VALUE}
        assert prompt == f"Answer only about {VALUE}."

    @pytest.mark.parametrize(
        "authored",
        [
            [{"name": "topic", "value": ""}],
            [{"name": "topic", "value": None}],
            [{"name": "", "value": VALUE}],
        ],
    )
    def test_a_row_with_no_usable_value_is_a_placeholder_not_a_substitution(
        self, authored: list[dict[str, Any]]
    ) -> None:
        """Why the projection does not filter these rows out in SQL.

        The SDK skips them itself -- "empty values are runtime placeholders"
        (`assistant.py:564-569`) -- and so does the native runtime's
        `variables::capture_variables`. Dropping them in the projection would
        hide from both decoders a row the edit page shows, and would make the
        runtime's view of a version disagree with `versionDetailsResponse`.
        """

        captured, prompt = rendered_prompt(
            version_details(variables=authored, meta={"step_limit": 25})
        )

        assert captured == {}
        assert prompt == "Answer only about {{ topic }}."


class TestTheAdapterHandsTheListOnUntouched:
    """The adapter is the only code between the projection and the SDK.

    `execute_application` deep-copies `version_details` and mutates exactly one
    thing in it -- the internal-tool names this image cannot build. A prune that
    reached any further would take the variables out again on the way past, and
    nothing downstream would report it.
    """

    def test_pruning_the_internal_tools_leaves_the_variables_alone(self) -> None:
        authored = [{"name": "topic", "value": VALUE}]
        version = {
            "meta": {"internal_tools": ["planner"], "step_limit": 7, "variables": authored},
            "variables": authored,
        }

        sdk_adapter._serve_version_internal_tools(version)

        assert version["variables"] == authored
        assert version["meta"]["variables"] == authored
