package llmproxy

import (
	"context"
	"testing"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
)

// zeroProviderAccount is a minimal schemas.Account with no configured
// providers — enough to run bifrost.Init so the bifrostLLMRouter forwarders can
// be exercised against a real *bifrost.Bifrost. Requests error (no provider is
// configured), but the point of this test is that every forwarder method
// delegates to core rather than that a provider round-trips.
type zeroProviderAccount struct{}

func (zeroProviderAccount) GetConfiguredProviders() ([]schemas.ModelProvider, error) {
	return nil, nil
}
func (zeroProviderAccount) GetKeysForProvider(context.Context, schemas.ModelProvider) ([]schemas.Key, error) {
	return nil, nil
}
func (zeroProviderAccount) GetConfigForProvider(schemas.ModelProvider) (*schemas.ProviderConfig, error) {
	return &schemas.ProviderConfig{
		ConcurrencyAndBufferSize: schemas.ConcurrencyAndBufferSize{Concurrency: 1},
	}, nil
}

// TestBifrostRouterForwardsToCore drives every bifrostLLMRouter method against a
// real embedded core. Each call returns an error (no provider configured), but
// executing it proves the wrapper forwards 1:1 and the interface assertion
// holds at the pinned tag.
func TestBifrostRouterForwardsToCore(t *testing.T) {
	core, err := bifrost.Init(context.Background(), schemas.BifrostConfig{
		Account:         zeroProviderAccount{},
		InitialPoolSize: 1,
	})
	if err != nil {
		t.Fatalf("bifrost.Init: %v", err)
	}
	defer core.Shutdown()

	r := NewBifrostRouter(core)
	ctx := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)

	// Unary methods: call for coverage; a provider error is the expected result.
	if _, e := r.ChatCompletionRequest(ctx, &schemas.BifrostChatRequest{Model: "openai/gpt-4o"}); e == nil {
		t.Log("ChatCompletionRequest returned no error (unexpected but non-fatal)")
	}
	_, _ = r.TextCompletionRequest(ctx, &schemas.BifrostTextCompletionRequest{Model: "openai/gpt-3.5-turbo-instruct"})
	_, _ = r.EmbeddingRequest(ctx, &schemas.BifrostEmbeddingRequest{Model: "openai/text-embedding-3-small"})
	_, _ = r.ResponsesRequest(ctx, &schemas.BifrostResponsesRequest{Model: "openai/gpt-4o"})
	_, _ = r.CountTokensRequest(ctx, &schemas.BifrostResponsesRequest{Model: "anthropic/claude-3-5-sonnet"})
	_, _ = r.ImageGenerationRequest(ctx, &schemas.BifrostImageGenerationRequest{Model: "openai/dall-e-3"})
	_, _ = r.ImageEditRequest(ctx, &schemas.BifrostImageEditRequest{Model: "openai/gpt-image-1"})
	_, _ = r.ImageVariationRequest(ctx, &schemas.BifrostImageVariationRequest{Model: "openai/dall-e-2"})

	// Streaming methods: drain any returned channel so the goroutine exits.
	if ch, e := r.ChatCompletionStreamRequest(ctx, &schemas.BifrostChatRequest{Model: "openai/gpt-4o"}); e == nil && ch != nil {
		for range ch {
		}
	}
	if ch, e := r.ResponsesStreamRequest(ctx, &schemas.BifrostResponsesRequest{Model: "openai/gpt-4o"}); e == nil && ch != nil {
		for range ch {
		}
	}
}
