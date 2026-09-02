package run

import (
	"encoding/json"
	"strings"
)

// DefaultBucket is where the graph lives when a toolkit configures none. The
// descriptor makes `bucket` a REQUIRED field, so in practice one always
// arrives; the legacy handler still defaulted, and a call that reached the
// engine without one uploaded to "graphs" rather than failing after the whole
// ingestion had run.
const DefaultBucket = "graphs"

// Object is one composed result object. Field order matches the legacy dicts
// so the encoded list reads as the recorded one.
type Object struct {
	Name            *string `json:"name,omitempty"`
	ObjectType      string  `json:"object_type"`
	ResultTarget    string  `json:"result_target"`
	ResultExtension string  `json:"result_extension,omitempty"`
	ResultEncoding  string  `json:"result_encoding"`
	ResultBucket    string  `json:"result_bucket,omitempty"`
	Data            string  `json:"data"`
}

// IsArtifact reports whether the object is bound for a bucket.
func (o Object) IsArtifact() bool { return o.ResultTarget == "artifact" }

// NameString is the artifact's key, "" for a message or a nameless artifact.
func (o Object) NameString() string {
	if o.Name == nil {
		return ""
	}
	return *o.Name
}

// Message is a response message object — the shape every Inventory tool
// answers with. The legacy `_create_success_response` built exactly this, and
// nothing else, for every one of its tools.
func Message(data string) Object {
	return Object{ObjectType: "message", ResultTarget: "response", ResultEncoding: "plain", Data: data}
}

// Artifact is a bucket-bound object.
func Artifact(name, objectType, extension, bucket, data string) Object {
	if bucket == "" {
		bucket = DefaultBucket
	}
	return Object{
		Name: &name, ObjectType: objectType, ResultTarget: "artifact",
		ResultExtension: extension, ResultEncoding: "plain", ResultBucket: bucket, Data: data,
	}
}

// ResolveBucket is the toolkit's configured bucket, read under both the bare
// name and the UI's `toolkit_configuration_` prefix — the two shapes the legacy
// handler read, because settings reached it either from the request or from a
// platform fetch.
func ResolveBucket(params Params) string {
	for _, key := range []string{"bucket", "toolkit_configuration_bucket"} {
		if value := strings.TrimSpace(str(params[key])); value != "" {
			return value
		}
	}
	return DefaultBucket
}

// extensionFor maps a returned artifact's content type onto the extension the
// platform derives its stored Content-Type from. It matters: elitea-main keys
// the object's type off the KEY's extension when the multipart part carries
// none, and an object stored as application/octet-stream is one the graph
// browser cannot read.
func extensionFor(contentType, name string) string {
	if index := strings.LastIndex(name, "."); index >= 0 && index < len(name)-1 {
		return name[index+1:]
	}
	switch contentType {
	case "application/json":
		return "json"
	case "text/markdown":
		return "md"
	default:
		return "txt"
	}
}

// objectTypeFor names what an artifact IS, for a reader that has only the
// composed list. The three the engine returns are the graph, a per-source
// ingestion checkpoint and the source status the UI's source list renders.
func objectTypeFor(name string) string {
	switch {
	case strings.HasPrefix(name, ".ingestion-checkpoint-"):
		return "ingestion_checkpoint"
	case name == "sources_status.json":
		return "sources_status"
	case strings.HasSuffix(name, "graph.json"):
		return "knowledge_graph"
	default:
		return "inventory_artifact"
	}
}

// ComposeResultObjects turns the engine's result dict into the result list.
//
// Simpler than DeepWiki's composer, and that is the legacy shape rather than a
// simplification: every Inventory tool answered with ONE message object plus
// whatever artifacts it returned (`_create_success_response(invocation_id,
// result, artifacts)`), with no per-tool branching at all.
func ComposeResultObjects(result map[string]any, bucket string) []Object {
	objects := []Object{Message(str(result["result"]))}
	list, _ := result["artifacts"].([]any)
	for _, raw := range list {
		artifact := object(raw)
		if artifact == nil {
			continue
		}
		name := str(artifact["name"])
		if name == "" {
			// A nameless artifact cannot be uploaded — the key IS the name —
			// and dropping it silently is how a graph goes missing with the
			// invocation still reporting success. Carry it inline instead, so
			// the caller has the bytes and the absence is visible.
			objects = append(objects, Message("⚠️ the engine returned an artifact with no name; it is not stored"))
			continue
		}
		objects = append(objects, Artifact(
			name,
			objectTypeFor(name),
			extensionFor(str(artifact["type"]), name),
			bucket,
			str(artifact["data"]),
		))
	}
	return objects
}

// CompletedBody is the terminal invocation body: result is a JSON STRING
// holding the object list, and result_type is always "String".
func CompletedBody(invocationID string, objects []Object) map[string]any {
	if objects == nil {
		objects = []Object{}
	}
	encoded, _ := json.Marshal(objects)
	return map[string]any{
		"invocation_id": invocationID,
		"status":        "Completed",
		"result":        string(encoded),
		"result_type":   "String",
	}
}
