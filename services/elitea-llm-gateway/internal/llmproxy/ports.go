// Package llmproxy is the gateway's /llm transport layer: it mounts the chi
// routes under /llm, decodes the OpenAI/Anthropic wire dialects into
// bifrost/core request structs itself, calls the embedded core request methods
// directly, and writes a net/http SSE loop over the returned
// chan *schemas.BifrostStreamChunk (design §6.3).
//
// It deliberately does NOT call the integrations Create*RouteConfigs factories
// (they require a fasthttp lib.HandlerStore) nor the RequestConverter /
// ChatStreamResponseConverter helpers with an *http.Request — those are
// fasthttp-internal and cannot be mounted here. The gateway owns its decode +
// SSE framing.
package llmproxy

import (
	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
)

// LLMRouter is the seam over the embedded bifrost/core client. The handler
// depends on this interface (not the concrete *bifrost.Bifrost) so the SSE
// loop, dialect decode, and error mapping are unit-testable with a fake that
// returns canned chunks and errors without a live provider.
//
// The methods mirror the core request methods the /llm surface needs
// (design §6.2). The second return is the concrete *schemas.BifrostError
// (which implements error) — handlers type-check it for status code, provider,
// and fallback fields rather than treating it as an opaque error.
type LLMRouter interface {
	// ChatCompletionRequest performs a unary OpenAI-dialect chat completion.
	ChatCompletionRequest(ctx *schemas.BifrostContext, req *schemas.BifrostChatRequest) (*schemas.BifrostChatResponse, *schemas.BifrostError)
	// ChatCompletionStreamRequest performs a streaming OpenAI-dialect chat completion.
	ChatCompletionStreamRequest(ctx *schemas.BifrostContext, req *schemas.BifrostChatRequest) (chan *schemas.BifrostStreamChunk, *schemas.BifrostError)
	// TextCompletionRequest performs a unary text (legacy completions) request.
	TextCompletionRequest(ctx *schemas.BifrostContext, req *schemas.BifrostTextCompletionRequest) (*schemas.BifrostTextCompletionResponse, *schemas.BifrostError)
	// EmbeddingRequest performs an embeddings request.
	EmbeddingRequest(ctx *schemas.BifrostContext, req *schemas.BifrostEmbeddingRequest) (*schemas.BifrostEmbeddingResponse, *schemas.BifrostError)
	// ResponsesRequest performs a unary Responses-API request. Anthropic
	// /v1/messages routes through this in v1.7.3 (RouteConfigTypeAnthropic).
	ResponsesRequest(ctx *schemas.BifrostContext, req *schemas.BifrostResponsesRequest) (*schemas.BifrostResponsesResponse, *schemas.BifrostError)
	// ResponsesStreamRequest performs a streaming Responses-API request. This is
	// the Anthropic /v1/messages streaming path in v1.7.3.
	ResponsesStreamRequest(ctx *schemas.BifrostContext, req *schemas.BifrostResponsesRequest) (chan *schemas.BifrostStreamChunk, *schemas.BifrostError)
	// CountTokensRequest performs a synchronous (non-SSE) token count. Backs
	// /v1/messages/count_tokens (a Responses-API request under the hood).
	CountTokensRequest(ctx *schemas.BifrostContext, req *schemas.BifrostResponsesRequest) (*schemas.BifrostCountTokensResponse, *schemas.BifrostError)
	// ImageGenerationRequest performs an image-generation request.
	ImageGenerationRequest(ctx *schemas.BifrostContext, req *schemas.BifrostImageGenerationRequest) (*schemas.BifrostImageGenerationResponse, *schemas.BifrostError)
	// ImageEditRequest performs an image-edit request (multipart body).
	ImageEditRequest(ctx *schemas.BifrostContext, req *schemas.BifrostImageEditRequest) (*schemas.BifrostImageGenerationResponse, *schemas.BifrostError)
	// ImageVariationRequest performs an image-variation request (multipart body).
	ImageVariationRequest(ctx *schemas.BifrostContext, req *schemas.BifrostImageVariationRequest) (*schemas.BifrostImageGenerationResponse, *schemas.BifrostError)
}

// bifrostLLMRouter is the default LLMRouter backed by the embedded
// *bifrost.Bifrost client. Its methods forward 1:1 to the core client; the
// *bifrost.Bifrost method set already matches LLMRouter, so this is a thin
// named wrapper that lets the concrete type satisfy the interface without
// leaking *bifrost.Bifrost into handler code.
type bifrostLLMRouter struct {
	core *bifrost.Bifrost
}

// NewBifrostRouter wraps an embedded bifrost/core client as an LLMRouter.
func NewBifrostRouter(core *bifrost.Bifrost) LLMRouter {
	return &bifrostLLMRouter{core: core}
}

func (r *bifrostLLMRouter) ChatCompletionRequest(ctx *schemas.BifrostContext, req *schemas.BifrostChatRequest) (*schemas.BifrostChatResponse, *schemas.BifrostError) {
	return r.core.ChatCompletionRequest(ctx, req)
}

func (r *bifrostLLMRouter) ChatCompletionStreamRequest(ctx *schemas.BifrostContext, req *schemas.BifrostChatRequest) (chan *schemas.BifrostStreamChunk, *schemas.BifrostError) {
	return r.core.ChatCompletionStreamRequest(ctx, req)
}

func (r *bifrostLLMRouter) TextCompletionRequest(ctx *schemas.BifrostContext, req *schemas.BifrostTextCompletionRequest) (*schemas.BifrostTextCompletionResponse, *schemas.BifrostError) {
	return r.core.TextCompletionRequest(ctx, req)
}

func (r *bifrostLLMRouter) EmbeddingRequest(ctx *schemas.BifrostContext, req *schemas.BifrostEmbeddingRequest) (*schemas.BifrostEmbeddingResponse, *schemas.BifrostError) {
	return r.core.EmbeddingRequest(ctx, req)
}

func (r *bifrostLLMRouter) ResponsesRequest(ctx *schemas.BifrostContext, req *schemas.BifrostResponsesRequest) (*schemas.BifrostResponsesResponse, *schemas.BifrostError) {
	return r.core.ResponsesRequest(ctx, req)
}

func (r *bifrostLLMRouter) ResponsesStreamRequest(ctx *schemas.BifrostContext, req *schemas.BifrostResponsesRequest) (chan *schemas.BifrostStreamChunk, *schemas.BifrostError) {
	return r.core.ResponsesStreamRequest(ctx, req)
}

func (r *bifrostLLMRouter) CountTokensRequest(ctx *schemas.BifrostContext, req *schemas.BifrostResponsesRequest) (*schemas.BifrostCountTokensResponse, *schemas.BifrostError) {
	return r.core.CountTokensRequest(ctx, req)
}

func (r *bifrostLLMRouter) ImageGenerationRequest(ctx *schemas.BifrostContext, req *schemas.BifrostImageGenerationRequest) (*schemas.BifrostImageGenerationResponse, *schemas.BifrostError) {
	return r.core.ImageGenerationRequest(ctx, req)
}

func (r *bifrostLLMRouter) ImageEditRequest(ctx *schemas.BifrostContext, req *schemas.BifrostImageEditRequest) (*schemas.BifrostImageGenerationResponse, *schemas.BifrostError) {
	return r.core.ImageEditRequest(ctx, req)
}

func (r *bifrostLLMRouter) ImageVariationRequest(ctx *schemas.BifrostContext, req *schemas.BifrostImageVariationRequest) (*schemas.BifrostImageGenerationResponse, *schemas.BifrostError) {
	return r.core.ImageVariationRequest(ctx, req)
}

// Compile-time assertions that both the concrete *bifrost.Bifrost method set
// and the default wrapper satisfy LLMRouter. The first guards against upstream
// signature drift at the pinned tag; the second guards the wrapper.
var (
	_ LLMRouter = (*bifrost.Bifrost)(nil)
	_ LLMRouter = (*bifrostLLMRouter)(nil)
)
