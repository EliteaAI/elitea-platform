package mcp

// The JSON-RPC 2.0 wire types the MCP transport carries.
//
// Hand-written rather than pulled from an SDK: the MCP Go SDK brings its own
// transport, session store and HTTP handler, and this service already owns all
// three of those decisions (chi routing, the authentication middleware, and
// deliberate statelessness). What is actually needed from the protocol here is
// four message shapes and five error codes, and writing them out keeps the
// dependency surface of a public, unauthenticated-until-the-middleware endpoint
// to the standard library.

import (
	"encoding/json"
	"errors"
)

// JSON-RPC 2.0 error codes (https://www.jsonrpc.org/specification#error_object).
const (
	codeParseError     = -32700
	codeInvalidRequest = -32600
	codeMethodNotFound = -32601
	codeInvalidParams  = -32602
	codeInternalError  = -32603
)

// rpcMessage is one inbound JSON-RPC message.
//
// `ID` is json.RawMessage because JSON-RPC allows a string, a number or null,
// and the response must echo the value the client sent, bit for bit — coercing
// a string id to a number (or the reverse) breaks correlation on clients that
// key their pending-request table on the exact value.
type rpcMessage struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params"`
}

// isNotification reports whether the message carries no id.
//
// JSON-RPC distinguishes a notification (no `id` member at all) from a request
// with a null id. `encoding/json` leaves `ID` nil for the former and the four
// bytes `null` for the latter, so the check is on the raw bytes rather than on
// a decoded value.
func (m rpcMessage) isNotification() bool {
	return len(m.ID) == 0 || string(m.ID) == "null"
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

// rpcResponse is one outbound JSON-RPC response.
//
// `Result` is `any` with `omitempty` and `Error` is a pointer so that exactly
// one of the two members is serialised: a response carrying both, or neither,
// is malformed, and several clients reject it rather than guessing.
type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

func newResult(id json.RawMessage, result any) rpcResponse {
	return rpcResponse{JSONRPC: "2.0", ID: normalizeID(id), Result: result}
}

func newError(id json.RawMessage, code int, message string) rpcResponse {
	return rpcResponse{JSONRPC: "2.0", ID: normalizeID(id), Error: &rpcError{Code: code, Message: message}}
}

// normalizeID keeps the response's `id` member present even when the request
// had none — JSON-RPC requires `id: null` on an error response whose request
// could not be parsed well enough to recover one.
func normalizeID(id json.RawMessage) json.RawMessage {
	if len(id) == 0 {
		return json.RawMessage("null")
	}
	return id
}

var errBatchUnsupported = errors.New("mcp: JSON-RPC batches are not supported")

// decodeMessage parses one JSON-RPC message.
//
// A top-level array is rejected explicitly rather than being reported as a
// parse error. Batching was optional in the 2025-03-26 revision of MCP and was
// REMOVED in 2025-06-18; no current client sends one, and a client that did
// deserves to be told that it is the batch that is refused, not its JSON.
func decodeMessage(raw []byte) (rpcMessage, error) {
	trimmed := skipJSONWhitespace(raw)
	if len(trimmed) > 0 && trimmed[0] == '[' {
		return rpcMessage{}, errBatchUnsupported
	}
	var message rpcMessage
	if err := json.Unmarshal(raw, &message); err != nil {
		return rpcMessage{}, err
	}
	return message, nil
}

func skipJSONWhitespace(raw []byte) []byte {
	for len(raw) > 0 {
		switch raw[0] {
		case ' ', '\t', '\r', '\n':
			raw = raw[1:]
		default:
			return raw
		}
	}
	return raw
}
