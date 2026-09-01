"""Persistence layer for notes.

Notes are stored in a single SQLite table and addressed by a stable note id.
"""


class NoteStore:
    """Durable storage for notes, backed by SQLite."""

    def __init__(self, connection):
        self.connection = connection

    def save_note(self, note_id, body, author):
        """Insert or replace one note row and return the stored note id."""
        self.connection.execute(
            "INSERT OR REPLACE INTO notes (note_id, body, author) VALUES (?, ?, ?)",
            (note_id, body, author),
        )
        return note_id

    def load_note(self, note_id):
        """Read a single note row by note id, or None when it is missing."""
        row = self.connection.execute(
            "SELECT note_id, body, author FROM notes WHERE note_id = ?", (note_id,)
        ).fetchone()
        return dict(row) if row else None

    def delete_note(self, note_id):
        """Remove one note row permanently."""
        self.connection.execute("DELETE FROM notes WHERE note_id = ?", (note_id,))
