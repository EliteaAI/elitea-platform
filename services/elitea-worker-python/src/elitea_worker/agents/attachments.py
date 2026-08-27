"""The `input_attachments` content contract (#606).

## What arrives here

``AgentExecutionInputV1.input_attachments`` is a JSON ARRAY OF LANGCHAIN
CONTENT CHUNKS — not a list of files. That is pylon's shape, not an invention:
an attachment is stored as an ``AttachmentMessageItem`` whose ``content`` is a
list of chunks (legacy/plugins/elitea_core/utils/attachments.py:272-320), and
the chat-history projection FLATTENS those lists into the message's content
list with ``extend`` rather than ``append``
(legacy/plugins/elitea_core/utils/chat_history.py:67-73). The current turn's
attachments therefore reach the model as extra chunks appended after the user's
own text, and this module produces exactly that list. The Go admission path
concatenates every attachment item's chunks into one flat array for the same
reason (services/elitea-main/internal/application/agentexecution/attachments.go,
``currentTurnInputAttachments``).

## The "needs extraction" marker

Pylon does not parse pdf/docx/xlsx itself. ``DocumentToModelProcessor.process``
emits ONE header chunk naming the bucket, the filename and the filepath, and
sets ``needs_content_extraction: True`` on the ITEM
(utils/attachments.py:288-320). A separate step then reads each file through
the SDK artifact toolkit's ``read_multiple_files``
(rpc/chat_all.py:344-377 → utils/attachments.py:429-497) and APPENDS the text
as a SECOND ``{"type": "text", ...}`` chunk of the same item
(rpc/chat_all.py:366-374).

Pylon never has to persist that flag — producer and consumer are the same
process, moments apart. Here they are two services, so the flag travels on the
CHUNK (the item boundary is gone once the chunks are flattened). The admission
path defines it as a namespaced sibling object, and this module is the reader
of that definition — the shape is stated in Go at
``attachmentExtractionMarkerKey`` and restated here so both ends can be read
side by side:

    {
      "type": "text",
      "text": "Bucket: <bucket>\\nFilename: <name>\\nfilepath: /<bucket>/<name>\\n\\nNOTE: ...",
      "elitea_attachment": {
        "needs_content_extraction": true,
        "bucket":   "chat-attachments",
        "name":     "<conversation-uuid>/report.pdf",
        "filepath": "/chat-attachments/<conversation-uuid>/report.pdf"
      }
    }

Consequences this module depends on:

  * ``bucket`` and ``name`` come from the marker, never from parsing ``text``.
    The worker cannot resolve pylon's per-project ``default_attachment_bucket``
    vault secret (utils/internal_tools.py:277-295) — it has no vault access —
    so the bucket has to be told to it, and ``name`` keeps its
    conversation-uuid prefix because that prefix is part of the object key.
  * The key is absent on image chunks, so "absent" means "nothing to do".
  * A marker whose ``needs_content_extraction`` is false is inert.
  * A header chunk IMMEDIATELY FOLLOWED by a plain text chunk (one with no
    marker of its own) already carries its extracted text and is not read
    again. That is exactly the storage shape pylon leaves behind after its
    extraction step ran, so a replayed turn does not pay for the read twice.

The marker is STRIPPED before the chunk reaches the model, which is what the Go
comment says the worker is expected to do. Nothing is lost — the header text
already states bucket, filename and filepath in prose — and no provider has to
be trusted to ignore an unknown key on a content chunk.

## Why an unknown chunk `type` is REFUSED rather than passed through

Pylon hands chunks to the model unvalidated, because in pylon the producer and
the consumer are the same process: only its own two processors can create them.
Here the producer is a different service. An unknown or malformed chunk that is
passed through does not fail at admission — it fails INSIDE the provider call,
after the turn has been admitted, the execution rows written and (for a
streaming turn) the first tokens billed, and it surfaces as an opaque provider
400 classified as an internal fault. Refusing at parse time makes the same
disagreement a typed ``INVALID_INPUT`` on a turn that never started.

The admitted set is the two chunk shapes pylon's own processors produce:
``text`` (DocumentToModelProcessor, utils/attachments.py:288-320) and
``image_url`` (ImageToModelProcessor, utils/attachments.py:183-225). Adding a
third is a one-line change to ``_ADMITTED_CHUNK_TYPES`` plus its shape check —
deliberately cheap, because the cost of being wrong in the other direction is
paid mid-turn.
"""

from __future__ import annotations

import logging
from copy import deepcopy
from typing import Any

from elitea_worker.execution.errors import InvalidInput


_LOG = logging.getLogger(__name__)

# The namespaced marker object. Its name and contents are fixed by the
# admission path (attachments.go, attachmentExtractionMarkerKey); this module
# only reads them.
ATTACHMENT_MARKER_KEY = "elitea_attachment"
ATTACHMENT_MARKER_EXTRACT_FIELD = "needs_content_extraction"

# The toolkit pylon reads attachments through (utils/internal_tools.py:27) and
# the tool it calls (utils/attachments.py:466-472). Named here rather than in
# the SDK adapter so the whole contract is readable in one file.
ATTACHMENT_TOOLKIT_TYPE = "artifact"
ATTACHMENT_TOOLKIT_NAME = "Attachments"
ATTACHMENT_READ_TOOL_NAME = "read_multiple_files"

_ADMITTED_CHUNK_TYPES = frozenset({"text", "image_url"})
_ADMITTED_MARKER_FIELDS = frozenset(
    {ATTACHMENT_MARKER_EXTRACT_FIELD, "bucket", "name", "filepath"}
)

# varchar(256) each side in migrations/tenant/0127, and the Go admission path
# refuses anything longer (attachments.go's maxAttachmentFieldBytes). A worker
# that admitted more would be admitting a reference the platform cannot have
# stored.
_MAX_ATTACHMENT_FIELD_BYTES = 256

# The Go admission transaction caps ONE turn at 64 attachments
# (attachments.go's maxCurrentTurnAttachments). Each of those can contribute at
# most two chunks here — its header and its already-extracted text — so 128 is
# that same bound expressed in the unit this list is counted in. It is not an
# independent policy: raising the Go cap without raising this one turns a large
# but legitimate turn into an admission refusal.
MAX_INPUT_ATTACHMENT_CHUNKS = 128


def validate_input_attachments(value: list[Any]) -> list[Any]:
    """Admit only chunks this worker can put in front of a model.

    Called from the protocol boundary, so a disagreement between the platform
    and the worker is an admission refusal on a turn that has not started
    rather than a LangChain or provider error in the middle of one.
    """

    if len(value) > MAX_INPUT_ATTACHMENT_CHUNKS:
        raise InvalidInput("The agent input attachments exceed their limit.")
    for chunk in value:
        if not isinstance(chunk, dict):
            raise InvalidInput("The agent input attachments must be content chunks.")
        chunk_type = chunk.get("type")
        if not isinstance(chunk_type, str) or not chunk_type:
            raise InvalidInput("The agent input attachment type is required.")
        if chunk_type not in _ADMITTED_CHUNK_TYPES:
            raise InvalidInput("The agent input attachment type is not supported.")
        if chunk_type == "text":
            if not isinstance(chunk.get("text"), str):
                raise InvalidInput("The agent input attachment text must be a string.")
        else:
            image = chunk.get("image_url")
            if not isinstance(image, dict) or not isinstance(image.get("url"), str):
                raise InvalidInput("The agent input attachment image is malformed.")
        _validate_marker(chunk.get(ATTACHMENT_MARKER_KEY))
    return value


def pending_attachment_reads(
    input_attachments: list[Any],
) -> list[tuple[str, str]]:
    """The (bucket, name) pairs whose text still has to be read.

    Deduplicated, in first-seen order: the same file attached twice costs one
    read, and the order is stable so a batch call is reproducible.
    """

    pending: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for index, chunk in enumerate(input_attachments):
        reference = _extraction_reference(input_attachments, index, chunk)
        if reference is None or reference in seen:
            continue
        seen.add(reference)
        pending.append(reference)
    return pending


def attachment_message_chunks(
    input_attachments: list[Any],
    extracted: dict[tuple[str, str], str] | None = None,
) -> list[Any]:
    """Project the admitted attachments into model-facing content chunks.

    One header chunk in, one header chunk out — always. A file whose text could
    not be read still reaches the model as its header, which names the file and
    tells the model that file-reading tools are available
    (utils/attachments.py:305-310). Dropping the header instead would leave the
    model answering about a file it was never told existed.
    """

    contents = extracted or {}
    chunks: list[Any] = []
    for index, chunk in enumerate(input_attachments):
        chunks.append(
            {
                key: deepcopy(item)
                for key, item in chunk.items()
                if key != ATTACHMENT_MARKER_KEY
            }
        )
        reference = _extraction_reference(input_attachments, index, chunk)
        if reference is None:
            continue
        text = contents.get(reference)
        if not isinstance(text, str) or not text:
            continue
        # Appended as a SECOND text chunk rather than folded into the header,
        # which is what pylon's extraction step does (rpc/chat_all.py:366-374)
        # and what makes an already-extracted attachment recognisable.
        chunks.append({"type": "text", "text": text})
    return chunks


def human_message_content(
    user_input: str | list[Any],
    attachment_chunks: list[Any],
) -> str | list[Any]:
    """Compose the turn's human message: the user's own content, then the files.

    With no attachments the content is returned unchanged, so an ordinary turn
    keeps sending a bare string and nothing about the existing multimodal path
    moves.
    """

    if not attachment_chunks:
        return deepcopy(user_input)
    if isinstance(user_input, list):
        content = deepcopy(user_input)
    elif user_input.strip():
        content = [{"type": "text", "text": user_input}]
    else:
        # An empty user message is a real case — attaching a file with no
        # question. Pylon's history builder skips empty text rather than
        # emitting an empty chunk (utils/chat_history.py:52-56), and some
        # providers reject one outright.
        content = []
    content.extend(attachment_chunks)
    return content


def report_failed_attachment_reads(count: int) -> None:
    """Record that N files could not be read, and continue the turn.

    Pylon logs the failure and proceeds (rpc/chat_all.py:384-386): a file the
    platform cannot read must not destroy a turn whose question may not even be
    about that file. The count is all that is recorded — filenames, buckets and
    the underlying error text are tenant data and stay out of worker logs, in
    line with the data-free diagnostics the rest of this worker keeps.
    """

    if count > 0:
        _LOG.warning(
            "agent input attachment content extraction failed for %d file(s)",
            count,
        )


def _validate_marker(marker: Any) -> None:
    """Admit only the marker object the admission path documents."""

    if marker is None:
        return
    if not isinstance(marker, dict):
        raise InvalidInput("The agent input attachment marker must be an object.")
    if set(marker) - _ADMITTED_MARKER_FIELDS:
        raise InvalidInput("The agent input attachment marker has unsupported fields.")
    needs_extraction = marker.get(ATTACHMENT_MARKER_EXTRACT_FIELD, False)
    if not isinstance(needs_extraction, bool):
        raise InvalidInput("The agent input attachment marker flag must be boolean.")
    for field in ("bucket", "name", "filepath"):
        present = marker.get(field)
        if present is not None and not _bounded_reference_text(present):
            raise InvalidInput("The agent input attachment reference is malformed.")
    if needs_extraction and not (
        _bounded_reference_text(marker.get("bucket"))
        and _bounded_reference_text(marker.get("name"))
    ):
        # Without both there is no object to read, and a marker that asks for
        # an impossible read is a contract disagreement, not a missing file.
        raise InvalidInput("The agent input attachment reference is required.")


def _bounded_reference_text(value: Any) -> bool:
    return (
        isinstance(value, str)
        and bool(value)
        and not any(character in value for character in ("\x00", "\r", "\n"))
        and len(value.encode("utf-8")) <= _MAX_ATTACHMENT_FIELD_BYTES
    )


def _extraction_reference(
    input_attachments: list[Any],
    index: int,
    chunk: Any,
) -> tuple[str, str] | None:
    """The file this chunk asks to have read, or None."""

    if not isinstance(chunk, dict):
        return None
    marker = chunk.get(ATTACHMENT_MARKER_KEY)
    if not isinstance(marker, dict) or marker.get(ATTACHMENT_MARKER_EXTRACT_FIELD) is not True:
        return None
    bucket = marker.get("bucket")
    name = marker.get("name")
    if not _bounded_reference_text(bucket) or not _bounded_reference_text(name):
        return None
    if _carries_extracted_text(input_attachments, index):
        return None
    return bucket, name


def _carries_extracted_text(input_attachments: list[Any], index: int) -> bool:
    """Whether the header at ``index`` is already followed by its own text."""

    successor = (
        input_attachments[index + 1] if index + 1 < len(input_attachments) else None
    )
    return (
        isinstance(successor, dict)
        and successor.get("type") == "text"
        and ATTACHMENT_MARKER_KEY not in successor
    )
