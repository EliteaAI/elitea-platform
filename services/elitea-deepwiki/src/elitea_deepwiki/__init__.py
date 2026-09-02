"""ELITEA DeepWiki engine package.

The standalone successor to the legacy ``deepwiki_plugin`` Pylon module
(ADR-0022), reduced by ADR-0023 to what needs the engine's dependency
closure: the copied analysis engine behind :mod:`elitea_deepwiki.engine`,
the sidecar that serves it to the Go sub-application host over a Unix
socket (:mod:`elitea_deepwiki.sidecar`), and the index storage with its
migrations. The provider SPI is served by ``services/elitea-subapp-host``.
"""
