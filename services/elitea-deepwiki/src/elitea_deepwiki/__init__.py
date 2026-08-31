"""ELITEA DeepWiki provider service.

The standalone successor to the legacy ``deepwiki_plugin`` Pylon module
(ADR-0022). This package currently carries the frozen provider SPI; the
analysis engine arrives behind :mod:`elitea_deepwiki.engine`'s seam.
"""

from .app import create_app

__all__ = ["create_app"]
