package pricesync

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestParseLiteLLMSkipsAndAliases(t *testing.T) {
	body := []byte(`{
		"sample_spec": {"litellm_provider": "openai", "input_cost_per_token": 0.1},
		"no_provider": {"input_cost_per_token": 0.1},
		"no_price": {"litellm_provider": "openai", "mode": "chat"},
		"gpt-4o": {
			"litellm_provider": "openai",
			"input_cost_per_token": 0.0000025,
			"output_cost_per_token": 0.00001,
			"cache_read_input_token_cost": 0.00000125
		},
		"gemini-pro": {
			"litellm_provider": "vertex_ai",
			"input_cost_per_token": 0.0000005,
			"output_cost_per_token": 0.0000015
		},
		"claude-sonnet": {
			"litellm_provider": "bedrock_converse",
			"input_cost_per_token": 0.000003
		}
	}`)
	got, err := parseLiteLLM(body)
	if err != nil {
		t.Fatalf("parseLiteLLM: %v", err)
	}
	byModel := map[string]RawModelPrice{}
	for _, r := range got {
		byModel[r.ModelName] = r
	}
	if _, ok := byModel["sample_spec"]; ok {
		t.Error("sample_spec must be skipped")
	}
	if _, ok := byModel["no_provider"]; ok {
		t.Error("entry without provider must be skipped")
	}
	if _, ok := byModel["no_price"]; ok {
		t.Error("entry without any price must be skipped")
	}
	if len(got) != 3 {
		t.Fatalf("expected 3 usable models, got %d", len(got))
	}
	if byModel["gemini-pro"].Provider != "vertex" {
		t.Errorf("vertex_ai must alias to vertex, got %q", byModel["gemini-pro"].Provider)
	}
	if byModel["claude-sonnet"].Provider != "bedrock" {
		t.Errorf("bedrock_converse must alias to bedrock, got %q", byModel["claude-sonnet"].Provider)
	}
	if byModel["gpt-4o"].Provider != "openai" {
		t.Errorf("openai must pass through, got %q", byModel["gpt-4o"].Provider)
	}
	// Per-token values must pass through raw (denomination handled by Normalizer).
	if byModel["gpt-4o"].InputCost == nil || *byModel["gpt-4o"].InputCost != 0.0000025 {
		t.Errorf("input cost must pass through raw per-token")
	}
}

// TestParseLiteLLMAdmitsAudioOnlyEntries pins the relaxed skip filter. Upstream
// prices a speech-to-text model per SECOND of audio and gives it no
// *_cost_per_token at all, so the older token-only filter dropped the exact
// models the audio columns exist to carry. The loss was silent, because a
// skipped entry is indistinguishable from a model upstream never published.
// Counted by script over the upstream sheet on 2026-08-20, 123 entries carried
// a non-token price field and no *_cost_per_token; 80 of those are in an audio
// mode and are what this filter recovers.
func TestParseLiteLLMAdmitsAudioOnlyEntries(t *testing.T) {
	body := []byte(`{
		"whisper-1": {
			"litellm_provider": "openai",
			"mode": "audio_transcription",
			"input_cost_per_second": 0.0001
		},
		"tts-1": {
			"litellm_provider": "openai",
			"mode": "audio_speech",
			"output_cost_per_character": 0.000015
		},
		"audio-in-out": {
			"litellm_provider": "openai",
			"mode": "audio_speech",
			"output_cost_per_second": 0.0002,
			"input_cost_per_character": 0.0000003
		},
		"no_price_at_all": {"litellm_provider": "openai", "mode": "chat"},
		"cache_only": {
			"litellm_provider": "openai",
			"cache_read_input_token_cost": 0.00000125
		}
	}`)
	got, err := parseLiteLLM(body)
	if err != nil {
		t.Fatalf("parseLiteLLM: %v", err)
	}
	byModel := map[string]RawModelPrice{}
	for _, r := range got {
		byModel[r.ModelName] = r
	}

	// The load-bearing case: ONLY input_cost_per_second, and it must survive.
	whisper, ok := byModel["whisper-1"]
	if !ok {
		t.Fatal("an entry with only input_cost_per_second must survive the filter")
	}
	if whisper.InputCostPerSecond == nil || *whisper.InputCostPerSecond != 0.0001 {
		t.Errorf("per-second price must pass through raw, got %v", whisper.InputCostPerSecond)
	}
	if whisper.InputCost != nil || whisper.OutputCost != nil {
		t.Errorf("audio-only entry must carry no token price, got in=%v out=%v",
			whisper.InputCost, whisper.OutputCost)
	}

	tts, ok := byModel["tts-1"]
	if !ok {
		t.Fatal("an entry with only output_cost_per_character must survive the filter")
	}
	if tts.OutputCostPerCharacter == nil || *tts.OutputCostPerCharacter != 0.000015 {
		t.Errorf("per-character price must pass through raw, got %v", tts.OutputCostPerCharacter)
	}

	both, ok := byModel["audio-in-out"]
	if !ok {
		t.Fatal("an entry with output_cost_per_second must survive the filter")
	}
	if both.OutputCostPerSecond == nil || *both.OutputCostPerSecond != 0.0002 {
		t.Errorf("output per-second price lost, got %v", both.OutputCostPerSecond)
	}
	if both.InputCostPerCharacter == nil || *both.InputCostPerCharacter != 0.0000003 {
		t.Errorf("input per-character price lost, got %v", both.InputCostPerCharacter)
	}

	// The filter is relaxed, not removed: an entry with none of the six prices
	// still carries nothing the catalog can store.
	if _, ok := byModel["no_price_at_all"]; ok {
		t.Error("entry with none of the six price fields must still be skipped")
	}
	// A cache cost alone prices nothing: cache_read is a discount on a token
	// price that this entry does not have.
	if _, ok := byModel["cache_only"]; ok {
		t.Error("entry with only a cache cost must still be skipped")
	}
	if len(got) != 3 {
		t.Fatalf("expected 3 admitted models, got %d (%+v)", len(got), got)
	}
}

// TestParseLiteLLMRejectsNonAudioPerSecondPrices pins the mode gate. Upstream
// reuses the four non-token price fields for units that are not audio, so a
// per-second price alone does not make an entry an audio entry:
//
//	video_generation      — veo prices a second of generated VIDEO.
//	chat (commitment SKU) — bedrock prices a second of RESERVED CAPACITY.
//	embedding             — vertex prices a character of TEXT.
//
// Without the gate each of those lands in the audio price columns, and the
// first route that bills generated media by the second charges the video rate
// as if it were an audio rate.
func TestParseLiteLLMRejectsNonAudioPerSecondPrices(t *testing.T) {
	body := []byte(`{
		"gemini/veo-3.1-generate-001": {
			"litellm_provider": "gemini",
			"mode": "video_generation",
			"output_cost_per_second": 0.75
		},
		"bedrock/us-east-1/1-month-commitment/anthropic.claude-v2": {
			"litellm_provider": "bedrock",
			"mode": "chat",
			"input_cost_per_second": 0.0455,
			"output_cost_per_second": 0.0455
		},
		"text-embedding-005": {
			"litellm_provider": "vertex_ai",
			"mode": "embedding",
			"input_cost_per_character": 0.000000025
		},
		"medlm-large": {
			"litellm_provider": "vertex_ai-language-models",
			"mode": "chat",
			"input_cost_per_token": 0.000005,
			"input_cost_per_character": 0.000005,
			"output_cost_per_character": 0.000015
		},
		"gpt-realtime-translate": {
			"litellm_provider": "openai",
			"mode": "realtime",
			"input_cost_per_second": 0.0005
		}
	}`)
	got, err := parseLiteLLM(body)
	if err != nil {
		t.Fatalf("parseLiteLLM: %v", err)
	}
	byModel := map[string]RawModelPrice{}
	for _, r := range got {
		byModel[r.ModelName] = r
	}

	// The load-bearing case: a video model priced per second of video must not
	// reach the audio columns. It has no other price, so the whole entry goes.
	if v, ok := byModel["gemini/veo-3.1-generate-001"]; ok {
		t.Errorf("video_generation entry must not be admitted, got %+v", v)
	}
	// Same shape, different non-audio unit: a reserved-capacity second.
	if v, ok := byModel["bedrock/us-east-1/1-month-commitment/anthropic.claude-v2"]; ok {
		t.Errorf("commitment SKU priced per second must not be admitted, got %+v", v)
	}
	// A character of text is not a character of speech.
	if v, ok := byModel["text-embedding-005"]; ok {
		t.Errorf("embedding entry priced per character must not be admitted, got %+v", v)
	}

	// An entry that has a real token price stays — only its non-audio
	// per-character fields are dropped. Dropping the whole row would lose a
	// token price the catalog can use.
	med, ok := byModel["medlm-large"]
	if !ok {
		t.Fatal("a chat entry with a token price must still be admitted")
	}
	if med.InputCost == nil || *med.InputCost != 0.000005 {
		t.Errorf("token price must survive, got %v", med.InputCost)
	}
	if med.InputCostPerCharacter != nil || med.OutputCostPerCharacter != nil {
		t.Errorf("non-audio per-character prices must be dropped, got in=%v out=%v",
			med.InputCostPerCharacter, med.OutputCostPerCharacter)
	}

	// realtime is on the admit list: gpt-realtime-translate's second IS a
	// second of audio.
	rt, ok := byModel["gpt-realtime-translate"]
	if !ok {
		t.Fatal("a realtime entry priced per second of audio must be admitted")
	}
	if rt.InputCostPerSecond == nil || *rt.InputCostPerSecond != 0.0005 {
		t.Errorf("realtime per-second price lost, got %v", rt.InputCostPerSecond)
	}

	if len(got) != 2 {
		t.Fatalf("expected 2 admitted models, got %d (%+v)", len(got), got)
	}
}

func TestParseLiteLLMUnknownProviderPassthrough(t *testing.T) {
	body := []byte(`{"weird": {"litellm_provider": "SomeNewProvider", "input_cost_per_token": 0.1}}`)
	got, err := parseLiteLLM(body)
	if err != nil {
		t.Fatalf("parseLiteLLM: %v", err)
	}
	if len(got) != 1 || got[0].Provider != "somenewprovider" {
		t.Errorf("unmapped provider must pass through lowercased, got %+v", got)
	}
}

func TestParseLiteLLMBadJSON(t *testing.T) {
	if _, err := parseLiteLLM([]byte(`not json`)); err == nil {
		t.Fatal("expected decode error")
	}
}

func TestLiteLLMFetchOK(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"gpt-4o": {"litellm_provider": "openai", "input_cost_per_token": 0.0000025}}`))
	}))
	defer srv.Close()

	src := NewLiteLLMSource(srv.URL, srv.Client())
	if src.Name() != "litellm" {
		t.Errorf("name = %q", src.Name())
	}
	if src.Denomination() != PerToken {
		t.Errorf("denomination = %v, want per-token", src.Denomination())
	}
	got, err := src.Fetch(context.Background())
	if err != nil {
		t.Fatalf("fetch: %v", err)
	}
	if len(got) != 1 || got[0].ModelName != "gpt-4o" {
		t.Errorf("unexpected fetch result %+v", got)
	}
}

func TestLiteLLMFetchNon200(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	src := NewLiteLLMSource(srv.URL, srv.Client())
	if _, err := src.Fetch(context.Background()); err == nil {
		t.Fatal("expected error on non-200 status")
	}
}

func TestLiteLLMFetchNetworkError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	url := srv.URL
	srv.Close() // ensure connection refused

	src := NewLiteLLMSource(url, &http.Client{})
	if _, err := src.Fetch(context.Background()); err == nil {
		t.Fatal("expected network error against closed server")
	}
}

func TestLiteLLMFetchCancelledContext(t *testing.T) {
	src := NewLiteLLMSource("http://127.0.0.1:0", &http.Client{})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := src.Fetch(ctx); err == nil {
		t.Fatal("expected error with cancelled context")
	} else if !errors.Is(err, context.Canceled) && !isURLErr(err) {
		// http.Client wraps the context error; either is acceptable.
		t.Logf("got err %v (acceptable)", err)
	}
}

func TestNewLiteLLMSourceDefaultURL(t *testing.T) {
	src := NewLiteLLMSource("", nil)
	if src.URL != LiteLLMURL {
		t.Errorf("empty url must fall back to canonical, got %q", src.URL)
	}
}

func isURLErr(err error) bool { return err != nil }
