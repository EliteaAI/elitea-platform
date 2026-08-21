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
	// Audio models bill a unit that is not a token, and LiteLLM publishes that
	// unit in its own field. A speech-to-text entry (whisper, gpt-4o-transcribe)
	// carries input_cost_per_second and NO *_cost_per_token at all; a
	// text-to-speech entry carries input_cost_per_character — the INPUT
	// direction, because a TTS provider sells the text you send it. Measured on
	// the sheet: tts-1, tts-1-hd and azure/tts-1 all carry
	// input_cost_per_character, and gpt-4o-mini-tts carries no character price
	// at all (it sells seconds and tokens). Reversing that direction here would
	// make every tts-1 request UNPRICED, because the gateway bills the character
	// basis against the INPUT rate. All of these are per SINGLE unit, exactly
	// like input_cost_per_token.
	//
	// Read these through audioRates, never directly: upstream puts the same
	// four fields on video, embedding and reserved-capacity entries, where the
	// second or the character is not audio. Mode is what separates them.
	InputCostPerSecond     *float64 `json:"input_cost_per_second"`
	OutputCostPerSecond    *float64 `json:"output_cost_per_second"`
	InputCostPerCharacter  *float64 `json:"input_cost_per_character"`
	OutputCostPerCharacter *float64 `json:"output_cost_per_character"`
}

// audioModes are the LiteLLM "mode" values whose per-second and per-character
// prices really measure audio. Upstream reuses the same four fields for units
// that are NOT audio, and the entry's mode is the only field that tells them
// apart:
//
//	audio_transcription — a second of speech sent in (whisper, gpt-4o-transcribe).
//	audio_speech        — a character of text spoken, or a second of speech out
//	                      (tts-1, gemini tts).
//	realtime            — gpt-realtime-translate prices a second of audio in.
//	                      The other realtime entries price audio as tokens and
//	                      are unaffected by this list.
//
// Every OTHER mode that carries one of the four fields bills a different unit.
// Measured against the upstream sheet on 2026-08-20: 28 "chat" entries carry a
// per-second price and all 28 are Bedrock provisioned-throughput commitment
// SKUs billing a second of RESERVED CAPACITY; 13 "video_generation" entries
// bill a second of generated VIDEO; 7 "embedding" and 4 "chat" entries bill a
// character of TEXT. Normalising any of those into the audio columns stores a
// rate for a unit the audio columns do not mean, so the first route that prices
// generated media or reserved capacity on this basis would overcharge.
var audioModes = map[string]bool{
	"audio_transcription": true,
	"audio_speech":        true,
	"realtime":            true,
}

// audioRates returns the four non-token rates the catalog may store for this
// entry, or all-nil when the entry's mode is not one that bills audio. An entry
// with no mode at all is not audio: upstream gives every audio entry a mode.
func (e litellmEntry) audioRates() (inSec, outSec, inChar, outChar *float64) {
	if !audioModes[strings.ToLower(strings.TrimSpace(e.Mode))] {
		return nil, nil, nil, nil
	}
	return e.InputCostPerSecond, e.OutputCostPerSecond,
		e.InputCostPerCharacter, e.OutputCostPerCharacter
}

// hasAnyPrice reports whether the entry carries at least one price the catalog
// can store. It is the admission test in parseLiteLLM. The four non-token
// fields count only when audioRates admits them, so a video-generation entry
// whose only price is a per-second one carries nothing storable and is skipped
// rather than admitted with an audio rate it does not have.
func (e litellmEntry) hasAnyPrice() bool {
	inSec, outSec, inChar, outChar := e.audioRates()
	return e.InputCostPerToken != nil ||
		e.OutputCostPerToken != nil ||
		inSec != nil ||
		outSec != nil ||
		inChar != nil ||
		outChar != nil
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
// schema-template key and any entry without a provider or without any price at
// all, and returns per-single-unit RawModelPrices.
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
		// A row with no price at all carries nothing the catalog can use.
		//
		// This test covers the non-token price fields too, not just the two
		// token ones. A speech-to-text entry prices seconds and carries no
		// *_cost_per_token at all, so the older token-only test discarded the
		// exact models the audio columns exist to carry, and it did so
		// silently: a skipped entry looks identical to a model upstream never
		// listed.
		//
		// Counted by script over the upstream sheet on 2026-08-20: of 3053
		// entries with a litellm_provider, 136 carry at least one of the four
		// non-token price fields, and 123 of those 136 carry no
		// *_cost_per_token. The 80 of the 123 that are in an audio mode are
		// what this widened test recovers; audioRates keeps the other 43 out,
		// because they bill a non-audio unit. Re-measure before you trust these
		// numbers: upstream adds models every week.
		if !e.hasAnyPrice() {
			continue
		}
		inSec, outSec, inChar, outChar := e.audioRates()
		out = append(out, RawModelPrice{
			Provider:               normalizeProvider(e.LiteLLMProvider),
			ModelName:              name,
			InputCost:              e.InputCostPerToken,
			OutputCost:             e.OutputCostPerToken,
			CacheCreationCost:      e.CacheCreationCost,
			CacheReadCost:          e.CacheReadCost,
			InputCostAbove128k:     e.InputCostAbove128k,
			InputCostPerSecond:     inSec,
			OutputCostPerSecond:    outSec,
			InputCostPerCharacter:  inChar,
			OutputCostPerCharacter: outChar,
		})
	}
	return out, nil
}
