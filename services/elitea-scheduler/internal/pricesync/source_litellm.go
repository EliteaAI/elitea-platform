package pricesync

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// LiteLLMURL is the canonical upstream price sheet (design §8.8). Prices there
// are PER SINGLE TOKEN (input_cost_per_token, e.g. 0.00000275).
const LiteLLMURL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"

// litellmEntry is the subset of a LiteLLM price-sheet entry the catalog needs.
// The upstream file is a map[modelName]entry; costs are per single token.
type litellmEntry struct {
	LiteLLMProvider    string   `json:"litellm_provider"`
	Mode               string   `json:"mode"`
	InputCostPerToken  *float64 `json:"input_cost_per_token"`
	OutputCostPerToken *float64 `json:"output_cost_per_token"`
	CacheCreationCost  *float64 `json:"cache_creation_input_token_cost"`
	CacheReadCost      *float64 `json:"cache_read_input_token_cost"`
	// LiteLLM's tiered above-128k input price (per token). Present only for a
	// handful of long-context models.
	InputCostAbove128k *float64 `json:"input_cost_per_token_above_128k_tokens"`
}

// LiteLLMSource fetches and parses the LiteLLM price sheet. Denomination is
// PerToken; the Normalizer applies the ×1,000,000 convert to per-1M.
type LiteLLMSource struct {
	URL    string
	Client *http.Client
}

// NewLiteLLMSource builds a LiteLLM source. A nil client falls back to a bounded
// default; an empty url falls back to the canonical LiteLLMURL.
func NewLiteLLMSource(url string, client *http.Client) *LiteLLMSource {
	if url == "" {
		url = LiteLLMURL
	}
	return &LiteLLMSource{URL: url, Client: client}
}

// Name implements PriceSource.
func (s *LiteLLMSource) Name() string { return "litellm" }

// Denomination implements PriceSource: LiteLLM publishes per single token.
func (s *LiteLLMSource) Denomination() Denomination { return PerToken }

// providerAlias maps LiteLLM's litellm_provider values onto the provider names
// the gateway_models catalog and the Bifrost account layer use. Unmapped
// providers pass through unchanged.
var providerAlias = map[string]string{
	"azure_ai":                  "azure",
	"azure":                     "azure",
	"vertex_ai":                 "vertex",
	"vertex_ai-language-models": "vertex",
	"bedrock_converse":          "bedrock",
	"bedrock":                   "bedrock",
	"anthropic":                 "anthropic",
	"openai":                    "openai",
}

func normalizeProvider(p string) string {
	if alias, ok := providerAlias[strings.ToLower(p)]; ok {
		return alias
	}
	return strings.ToLower(p)
}

// Fetch implements PriceSource. It GETs the price sheet, skips the "sample_spec"
// schema-template key and any entry without a provider or a chat/completion-ish
// price, and returns per-token RawModelPrices.
func (s *LiteLLMSource) Fetch(ctx context.Context) ([]RawModelPrice, error) {
	client := s.Client
	if client == nil {
		client = http.DefaultClient
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.URL, nil)
	if err != nil {
		return nil, fmt.Errorf("litellm: build request: %w", err)
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("litellm: fetch: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("litellm: unexpected status %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("litellm: read body: %w", err)
	}
	return parseLiteLLM(body)
}

// parseLiteLLM decodes the price sheet body into RawModelPrices. Split out from
// Fetch so it is unit-testable without HTTP.
func parseLiteLLM(body []byte) ([]RawModelPrice, error) {
	var raw map[string]litellmEntry
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("litellm: decode: %w", err)
	}
	out := make([]RawModelPrice, 0, len(raw))
	for name, e := range raw {
		// sample_spec is a schema-template placeholder, not a real model.
		if name == "sample_spec" {
			continue
		}
		if e.LiteLLMProvider == "" {
			continue
		}
		// A row with no input/output price carries nothing the catalog can use.
		if e.InputCostPerToken == nil && e.OutputCostPerToken == nil {
			continue
		}
		out = append(out, RawModelPrice{
			Provider:           normalizeProvider(e.LiteLLMProvider),
			ModelName:          name,
			InputCost:          e.InputCostPerToken,
			OutputCost:         e.OutputCostPerToken,
			CacheCreationCost:  e.CacheCreationCost,
			CacheReadCost:      e.CacheReadCost,
			InputCostAbove128k: e.InputCostAbove128k,
		})
	}
	return out, nil
}
