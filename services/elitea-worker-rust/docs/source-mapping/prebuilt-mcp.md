# Prebuilt MCP source mapping

Status: partial and capability-disabled.

This slice admits fixed HTTP definitions from Main's durable catalogue. It does not execute arbitrary local processes.

## Ownership

| Current behavior source | Product behavior | New owner |
| --- | --- | --- |
| SDK `runtime/toolkits/mcp_config.py::McpConfigToolkit` | Resolve `mcp_config` by `server_name` and filter discovered tools. | Main resolves authority. Rust filters and executes tools. |
| SDK `runtime/toolkits/mcp_config.py::_load_http_tools` | Connect through HTTP with fixed headers and optional delegated tokens. | Rust `src/toolkits/mcp.rs` uses ADK RMCP. |
| Indexer `methods/indexer_mcp_prebuilt_config.py` | Publish dynamic `mcp_*` toolkit types from configured servers. | Main reads enabled `elitea_mcp.prebuilt_servers` rows. |
| Core `methods/mcp_prebuilt_config.py` | Match normalized server names and toolkit types. | Main `internal/mcpregistry` performs the lookup. |
| Core and SDK configuration expansion | Keep secrets outside queued execution documents. | Main resolves the row after claim. |

## Runtime contract

Main admits only enabled catalogue entries. Missing and disabled entries fail before worker connection.

Main accepts `mcp_config` selectors and dynamic `mcp_*` types. Both forms resolve through exact normalized catalogue keys.

Main keeps only the selector, tool filters, and cache controls before it signs the command.

The catalogue owns the URL, timeout, TLS policy, and fixed headers. Caller-supplied connection authority is discarded.

The project still owns `selected_tools`, `excluded_tools`, caching controls, and the attached toolkit name.

Rust receives only Main's claim-materialized input. It accepts prebuilt authority from admitted `mcp_config` and `mcp_*` types.

Direct `mcp` retains its existing strict authority path.

Rust bounds header counts and sizes. It marks every configured header value as sensitive.

Rust rejects headers that control HTTP framing or MCP protocol negotiation. A claim-fetched OAuth token replaces static `Authorization`.

Delegated authorization retains the original dynamic toolkit type. Exact endpoint and prebuilt aliases can resolve the returned token.

## Verification

Main tests cover enabled schema admission, disabled entries, missing rows, dependency failures, and exact selector lookup.

Claim tests cover forged-marker removal, authoritative connection replacement, redacted failures, and direct-MCP separation.

Rust tests cover static headers, header sensitivity, exclusions, reserved headers, token precedence, aliases, and authorization identity.

## Remaining gates

Parameterized catalogue schemas and `{field}` substitution remain gated. They need secret-aware dynamic schema storage.

Stdio remains assigned to an external runner with explicit process, package, environment, and egress authority.

Runtime post-discovery authorization failures need typed RMCP call errors before automatic reauthorization can be safe.

MCP catalogue editing, sync, internal PAT stamping, and Elitea-as-MCP exposure remain separate platform capabilities.
