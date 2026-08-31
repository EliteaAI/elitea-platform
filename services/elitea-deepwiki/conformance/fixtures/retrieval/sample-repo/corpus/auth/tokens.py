"""Bearer token issuing and verification."""

import hmac


def issue_token(subject, secret):
    """Mint a signed bearer token for a subject."""
    signature = hmac.new(secret.encode(), subject.encode(), "sha256").hexdigest()
    return f"{subject}.{signature}"


def verify_token(token, secret):
    """Verify a bearer token signature and return the subject, or None."""
    subject, _, signature = token.partition(".")
    expected = hmac.new(secret.encode(), subject.encode(), "sha256").hexdigest()
    return subject if hmac.compare_digest(expected, signature) else None


class TokenError(Exception):
    """Raised when a bearer token cannot be verified."""
