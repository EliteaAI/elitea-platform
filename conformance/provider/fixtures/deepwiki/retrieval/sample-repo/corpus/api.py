"""HTTP entry points for the notes service."""

from auth.tokens import verify_token
from notes.search import rank_notes
from notes.store import NoteStore


def handle_create_note(request, store, secret):
    """Authenticate the request and store the submitted note."""
    author = verify_token(request["token"], secret)
    if author is None:
        return {"status": 401}
    store.save_note(request["note_id"], request["body"], author)
    return {"status": 201, "note_id": request["note_id"]}


def handle_search(request, notes):
    """Return notes ranked against the query in the request."""
    return {"status": 200, "results": rank_notes(notes, request["query"])}
