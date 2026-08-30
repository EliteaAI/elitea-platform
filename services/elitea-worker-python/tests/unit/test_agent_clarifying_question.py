"""The `ask_user` clarification, from the browser's answer to the model's input.

The pause itself already worked on this worker: `ask_user` is an ordinary SDK
tool (`elitea_sdk/runtime/tools/ask_user.py`), the SDK registers it from the
same `meta.internal_tools` name the native runtime reads, and it raises the
clarifying-question interrupt the browser renders controls for. What did not
work was the ANSWER, and it failed in two independent places:

  1. the adapter refused the `answer` action outright — covered beside the
     other resume admissions in `test_agent.py`;
  2. the question ids the browser keys that answer by were not the model's.

This file is the second half, and it is written as a ROUND TRIP rather than as
a unit assertion on a helper: the SDK's own `_normalize_questions` builds the
pause and its own `_format_answer` builds the tool result, so a change that
preserved the id but broke either one would pass a narrower test and still
reach the model with the wrong question attached to the user's answer.

WHY THE ASSERTIONS QUOTE THE NATIVE RUNTIME. Every expected string here is what
`AskUserRequest::format_answer`
(services/elitea-worker-rust/src/agents/internal_tools.rs) produces for the same
questions and the same answer. That is the whole point of the fix: one browser
payload, two runtimes, one thing the model reads.
"""

from __future__ import annotations

import importlib
from types import SimpleNamespace
from typing import Any

import pytest

from elitea_worker.agents import sdk_adapter


ENCODED_SINGLE_ANSWER = '{"environment": "Staging"}'


@pytest.fixture
def ask_user() -> Any:
    """The SDK's ask_user module, with this worker's tool installed on it.

    `interrupt()` is replaced per call because the real one needs a running
    LangGraph task to suspend into. Everything else — the argument schema, the
    normalisation, the interrupt payload and the answer formatting — is the
    SDK's own code, which is what makes this a round trip and not a mock.
    """

    sdk_adapter._install_ask_user_question_ids()
    return importlib.import_module(sdk_adapter._ASK_USER_TOOL_MODULE)


def _answer(module: Any, questions: list[dict[str, Any]], encoded: str) -> tuple[dict, str]:
    """Ask `questions`, answer with the browser's `encoded` value, return both.

    The resume value is built by the adapter under test rather than written out
    by hand, so the encoded string the browser posts and the value the SDK
    resumes with stay one decision and not two.
    """

    pause: dict[str, Any] = {}
    resume = {
        "action": "answer",
        "value": sdk_adapter._hitl_resume_value(
            SimpleNamespace(hitl_action="answer", hitl_value=encoded)
        ),
    }

    def _interrupt(payload: dict[str, Any]) -> dict[str, Any]:
        pause.update(payload)
        return resume

    original = module.interrupt
    module.interrupt = _interrupt
    try:
        result = module.AskUserTool(auto_skip=False).invoke({"questions": questions})
    finally:
        module.interrupt = original
    return pause, result


class TestQuestionIdentity:
    """Task 2: the id the MODEL chose, not the one the SDK numbered."""

    def test_the_models_id_reaches_the_pause_and_binds_the_answer(
        self, ask_user: Any
    ) -> None:
        # Without this the pause advertised `q1`, the browser keyed its answer
        # object by `q1`, and the same model output produced
        # `{"q1": "Staging"}` here against `{"environment": "Staging"}` on the
        # native runtime — two payloads for one card.
        pause, result = _answer(
            ask_user,
            [
                {
                    "id": "environment",
                    "question": "Which environment should I target?",
                    "header": "Environment",
                    "options": [
                        {"label": "Staging", "description": "the shared stack"},
                        {"label": "Production", "description": "the live stack"},
                    ],
                    "allow_other": True,
                }
            ],
            ENCODED_SINGLE_ANSWER,
        )

        assert [question["id"] for question in pause["questions"]] == ["environment"]
        assert pause["guardrail_type"] == "clarifying_question"
        assert pause["available_actions"] == ["answer"]
        # The options survive too: a card with the ids but no labels offers
        # nothing to click.
        assert [option["label"] for option in pause["questions"][0]["options"]] == [
            "Staging",
            "Production",
        ]
        assert result == "User answered:\n- Which environment should I target?: Staging"

    def test_a_question_with_no_id_keeps_the_positional_default(
        self, ask_user: Any
    ) -> None:
        # The native runtime numbers an id-less question `q{n}` as well, so the
        # browser can still answer a model that names nothing.
        pause, result = _answer(
            ask_user,
            [{"question": "Which environment should I target?"}],
            '{"q1": "Staging"}',
        )

        assert [question["id"] for question in pause["questions"]] == ["q1"]
        assert result == "User answered:\n- Which environment should I target?: Staging"

    @pytest.mark.parametrize(
        "identifier",
        ["e" * 65, "env\nironment", ""],
        ids=["too-long", "control-character", "empty"],
    )
    def test_an_id_the_native_runtime_would_refuse_falls_back(
        self, ask_user: Any, identifier: str
    ) -> None:
        # Dropped rather than refused: a bad NAME for a question is not an
        # unanswerable pause, and the browser can always answer a `q1`.
        pause, result = _answer(
            ask_user,
            [{"id": identifier, "question": "Which environment should I target?"}],
            '{"q1": "Staging"}',
        )

        assert [question["id"] for question in pause["questions"]] == ["q1"]
        assert result == "User answered:\n- Which environment should I target?: Staging"

    def test_several_questions_keep_their_own_ids_in_order(
        self, ask_user: Any
    ) -> None:
        # The case a positional translation in the adapter could not have
        # survived: the user left the FIRST question blank, so the browser
        # omits it (`buildAnswerValue`) and the surviving key is the second
        # question's. Keyed by id this lands on the question that was asked;
        # keyed by position it would land on the first.
        pause, result = _answer(
            ask_user,
            [
                {"id": "environment", "question": "Which environment?"},
                {"id": "mode", "question": "Which mode?", "multi_select": True},
            ],
            '{"mode": ["Fast", "Safe"]}',
        )

        assert [question["id"] for question in pause["questions"]] == [
            "environment",
            "mode",
        ]
        assert result == "User answered:\n- Which mode?: Fast, Safe"

    def test_installing_twice_leaves_one_tool(self, ask_user: Any) -> None:
        # Called on every run, beside `ensure_sdk_state_directory`.
        installed = ask_user.AskUserTool
        sdk_adapter._install_ask_user_question_ids()
        assert ask_user.AskUserTool is installed


class TestAnswerValue:
    """Task 1: what the paused tool is resumed WITH."""

    def test_the_no_questions_fallback_reaches_the_model_as_words(
        self, ask_user: Any
    ) -> None:
        # A pause whose questions never reached the browser is answered with a
        # bare JSON string. Decoded, the model reads the sentence the user
        # typed; left encoded it would read `User answered: "ship it"`.
        _, result = _answer(
            ask_user,
            [{"question": "Which environment should I target?"}],
            '"ship it"',
        )

        assert result == "User answered: ship it"

    @pytest.mark.parametrize(
        ("encoded", "expected"),
        [
            ('{"environment": "Staging"}', {"environment": "Staging"}),
            ('{"regions": ["eu", "us"]}', {"regions": ["eu", "us"]}),
            ('"ship it"', "ship it"),
            # Passed through unchanged: the answer still reaches the model as
            # the user's own words rather than being dropped or raising.
            ("ship it", "ship it"),
            ('{"count": 3}', '{"count": 3}'),
            ('{"nested": {"a": "b"}}', '{"nested": {"a": "b"}}'),
            ("[1, 2]", "[1, 2]"),
            ("3", "3"),
        ],
    )
    def test_only_the_shapes_the_browser_submits_are_decoded(
        self, encoded: str, expected: Any
    ) -> None:
        assert (
            sdk_adapter._hitl_resume_value(
                SimpleNamespace(hitl_action="answer", hitl_value=encoded)
            )
            == expected
        )

    @pytest.mark.parametrize(
        "action", ["edit", "block_with_comment", "reject", "approve"]
    )
    def test_every_other_action_still_resumes_with_its_own_text(
        self, action: str
    ) -> None:
        # `edit` in particular: its value is REPLAYED as the user's message
        # (`_invoke_initial_agent`), and text that happens to parse as JSON
        # must not become a mapping on the way.
        assert (
            sdk_adapter._hitl_resume_value(
                SimpleNamespace(hitl_action=action, hitl_value='{"a": "b"}')
            )
            == '{"a": "b"}'
        )

    def test_an_absent_value_stays_the_empty_string(self) -> None:
        assert (
            sdk_adapter._hitl_resume_value(
                SimpleNamespace(hitl_action="answer", hitl_value=None)
            )
            == ""
        )
