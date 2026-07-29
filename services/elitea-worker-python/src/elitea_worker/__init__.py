"""Standalone ELITEA reference worker."""

import ssl as _ssl

# Capture the standard-library context before importing the SDK. The current
# SDK intentionally injects the host trust store into ``ssl`` for ordinary
# outbound integrations; the worker's private control/output/content planes
# must remain pinned to their explicitly deployed CA instead.
_PRIVATE_PLANE_SSL_CONTEXT = _ssl.SSLContext
_PRIVATE_PLANE_SSL_CONTEXT_BASE = _ssl.SSLContext.__mro__[1]

__version__ = "0.1.0"
