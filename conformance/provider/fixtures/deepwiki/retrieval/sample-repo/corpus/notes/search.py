"""Ranking helpers for note search."""


def tokenize(text):
    """Split text into lowercase word tokens for ranking."""
    return [token.lower() for token in text.split() if token]


def rank_notes(notes, query):
    """Rank notes by term overlap with the query, highest score first."""
    terms = set(tokenize(query))
    scored = []
    for note in notes:
        overlap = len(terms & set(tokenize(note["body"])))
        scored.append((overlap, note))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [note for score, note in scored if score > 0]


class SearchIndex:
    """In-memory inverted index over note bodies."""

    def __init__(self):
        self.postings = {}

    def add(self, note_id, body):
        """Add one note body to the inverted index."""
        for token in tokenize(body):
            self.postings.setdefault(token, set()).add(note_id)
