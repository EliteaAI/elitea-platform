"""Standalone ELITEA reference worker."""

import _ssl as _ssl_backend
import ssl as _ssl

# Recover the standard-library context even when the SDK has already inserted
# a truststore wrapper ahead of it in the MRO. The worker's private
# control/output/content planes must remain pinned to their deployed CA.
_PRIVATE_PLANE_SSL_CONTEXT_BASE = _ssl_backend._SSLContext
_PRIVATE_PLANE_SSL_CONTEXT = next(
    candidate
    for candidate in _ssl.SSLContext.__mro__
    if _PRIVATE_PLANE_SSL_CONTEXT_BASE in candidate.__bases__
)

__version__ = "0.1.0"
