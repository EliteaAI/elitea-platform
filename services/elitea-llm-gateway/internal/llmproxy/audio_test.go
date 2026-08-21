// audio_test.go — the /llm/v1/audio surface (issue #323).
//
// These tests assert the wire shape the CALLERS need, not the shape this
// package finds convenient. The callers are pylon-indexer's voice paths, which
// were written against the retired LiteLLM proxy:
//
//   - indexer_tts.py POSTs JSON to /v1/audio/speech and reads the response body
//     as raw audio with `iter_content`. A JSON body there is silence.
//   - indexer_asr_whisper.py POSTs a multipart `file` + `model` + `language` to
//     /v1/audio/transcriptions and reads `response.json()["text"]`.
package llmproxy

import (
	"bytes"
	"encoding/json"
	"math"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"

	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/cost"
)

// audioHandler builds a handler with no model resolver, so mapModel forwards
// the caller's model unchanged and these tests observe the audio path alone.
func audioHandler(f *fakeRouter) http.Handler {
	return NewHandler(f, nil, nil).route()
}

// postAudioJSON posts a JSON body to path.
func postAudioJSON(t *testing.T, h http.Handler, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(headerProjectID, "42")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// postAudioFile posts the multipart body indexer_asr_whisper.py sends: one
// `file` part plus `model` and any extra text fields.
func postAudioFile(t *testing.T, h http.Handler, path string, fields map[string]string, audio []byte) *httptest.ResponseRecorder {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for k, v := range fields {
		if err := mw.WriteField(k, v); err != nil {
			t.Fatalf("write field %q: %v", k, err)
		}
	}
	if audio != nil {
		part, err := mw.CreateFormFile("file", "audio.wav")
		if err != nil {
			t.Fatalf("create file part: %v", err)
		}
		if _, err := part.Write(audio); err != nil {
			t.Fatalf("write file part: %v", err)
		}
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close writer: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(buf.Bytes()))
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set(headerProjectID, "42")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// TestSpeech_AnswersRawAudioNotJSON is the contract indexer_tts.py reads. A
// JSON envelope here would be delivered to the browser's audio scheduler as
// noise, and nothing on the path would report an error.
func TestSpeech_AnswersRawAudioNotJSON(t *testing.T) {
	audio := []byte{0x01, 0x02, 0x03, 0x04}
	h := audioHandler(&fakeRouter{speechResp: &schemas.BifrostSpeechResponse{Audio: audio}})

	rec := postAudioJSON(t, h, "/llm/v1/audio/speech",
		`{"model":"tts-1","input":"hello","voice":"alloy","response_format":"pcm"}`)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if got := rec.Body.Bytes(); !bytes.Equal(got, audio) {
		t.Fatalf("body = %v, want the provider's audio bytes %v", got, audio)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "audio/L16") {
		t.Fatalf("Content-Type = %q, want the audio/L16 form for response_format=pcm", ct)
	}
}

// TestSpeech_ContentTypeFollowsResponseFormat covers the rest of the format
// map, including the unknown format that must not be mislabelled as audio.
func TestSpeech_ContentTypeFollowsResponseFormat(t *testing.T) {
	cases := []struct {
		format string
		want   string
	}{
		{"", "audio/mpeg"}, // absent means mp3, the OpenAI default
		{"mp3", "audio/mpeg"},
		{"wav", "audio/wav"},
		{"opus", "audio/opus"},
		{"flac", "audio/flac"},
		{"aac", "audio/aac"},
		{"not-a-format", "application/octet-stream"},
	}
	for _, tc := range cases {
		t.Run(tc.format, func(t *testing.T) {
			if got := speechContentType(tc.format); got != tc.want {
				t.Fatalf("speechContentType(%q) = %q, want %q", tc.format, got, tc.want)
			}
		})
	}
}

// TestTranscription_AnswersJSONWithText is the contract
// indexer_asr_whisper.py reads: `response.json()["text"]`.
func TestTranscription_AnswersJSONWithText(t *testing.T) {
	h := audioHandler(&fakeRouter{
		transcriptionResp: &schemas.BifrostTranscriptionResponse{Text: "hello world"},
	})

	rec := postAudioFile(t, h, "/llm/v1/audio/transcriptions",
		map[string]string{"model": "whisper-1", "language": "en"}, []byte("RIFF"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var payload struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode body %q: %v", rec.Body.String(), err)
	}
	if payload.Text != "hello world" {
		t.Fatalf("text = %q, want %q", payload.Text, "hello world")
	}
}

// TestTranscription_TextFormatsAnswerPlainText covers the other half of the
// OpenAI contract: response_format=text/srt/vtt returns the transcript itself,
// not a JSON envelope around it.
func TestTranscription_TextFormatsAnswerPlainText(t *testing.T) {
	for _, format := range []string{"text", "srt", "vtt"} {
		t.Run(format, func(t *testing.T) {
			f := format
			h := audioHandler(&fakeRouter{
				transcriptionResp: &schemas.BifrostTranscriptionResponse{
					Text: "plain transcript", ResponseFormat: &f,
				},
			})
			rec := postAudioFile(t, h, "/llm/v1/audio/transcriptions",
				map[string]string{"model": "whisper-1", "response_format": format}, []byte("RIFF"))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
			}
			if got := rec.Body.String(); got != "plain transcript" {
				t.Fatalf("body = %q, want the bare transcript", got)
			}
			if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/plain") {
				t.Fatalf("Content-Type = %q, want text/plain", ct)
			}
		})
	}
}

// TestTranscription_CarriesTheUploadedFileAndFilename proves the audio and its
// extension reach the provider. The filename is the only thing that tells a
// provider the container format, and ToBifrostTranscriptionRequest does not
// copy it — the handler must.
func TestTranscription_CarriesTheUploadedFileAndFilename(t *testing.T) {
	var seen *schemas.BifrostTranscriptionRequest
	f := &fakeRouter{transcriptionResp: &schemas.BifrostTranscriptionResponse{Text: "ok"}}
	spy := &transcriptionCapture{fakeRouter: *f, seen: &seen}
	h := NewHandler(spy, nil, nil).route()

	audio := []byte("RIFF-payload")
	rec := postAudioFile(t, h, "/llm/v1/audio/transcriptions",
		map[string]string{"model": "whisper-1"}, audio)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if seen == nil || seen.Input == nil {
		t.Fatal("the provider received no transcription input")
	}
	if !bytes.Equal(seen.Input.File, audio) {
		t.Fatalf("provider file = %q, want %q", seen.Input.File, audio)
	}
	if seen.Input.Filename != "audio.wav" {
		t.Fatalf("provider filename = %q, want audio.wav: the extension names the container format",
			seen.Input.Filename)
	}
}

// transcriptionCapture records the request the provider received.
type transcriptionCapture struct {
	fakeRouter
	seen **schemas.BifrostTranscriptionRequest
}

func (c *transcriptionCapture) TranscriptionRequest(ctx *schemas.BifrostContext, req *schemas.BifrostTranscriptionRequest) (*schemas.BifrostTranscriptionResponse, *schemas.BifrostError) {
	*c.seen = req
	return c.fakeRouter.TranscriptionRequest(ctx, req)
}

// TestTranscription_RejectsAMissingFile keeps the required-field contract. A
// request with no audio must fail at the gateway with a named 400, not reach a
// provider that answers something opaque.
func TestTranscription_RejectsAMissingFile(t *testing.T) {
	h := audioHandler(&fakeRouter{
		transcriptionResp: &schemas.BifrostTranscriptionResponse{Text: "unreachable"},
	})
	rec := postAudioFile(t, h, "/llm/v1/audio/transcriptions",
		map[string]string{"model": "whisper-1"}, nil)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "file") {
		t.Fatalf("the 400 does not name the missing field: %s", rec.Body.String())
	}
}

// TestAudioRoutes_RefuseAnUnadvertisedModel proves the audio routes are gated
// by the same model map every other dialect uses. Without the asr/tts pairs in
// addressableModelSections this would 404 for a CONFIGURED model; without
// mapModel on the route it would forward whatever the caller wrote.
func TestAudioRoutes_RefuseAnUnadvertisedModel(t *testing.T) {
	rows := []fakeModelRow{
		{title: "Voice out", data: []byte(`{"name":"openai/tts-1"}`), section: "tts", typ: "tts_model"},
	}
	h, spy := newMapHandler(t, rows)

	rec := postAudioJSON(t, h, "/llm/v1/audio/speech",
		`{"model":"a-model-no-project-configured","input":"hi","voice":"alloy"}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	if spy.count() != 0 {
		t.Fatalf("the provider was called %d times for an unadvertised model, want 0", spy.count())
	}
}

// TestTranscriptionUnits_SelectsOneBasis pins the fixed precedence for the
// transcription route (issue #323).
//
// whisper-1 is sold by the second, so a duration-billed response must reach the
// money path as MILLISECONDS on the seconds basis. It must never be turned into
// a token count: an invented count reaches the authoritative budget counter as
// if it were measured.
func TestTranscriptionUnits_SelectsOneBasis(t *testing.T) {
	sec := func(v float64) *float64 { return &v }
	num := func(v int) *int { return &v }

	cases := []struct {
		name      string
		usage     *schemas.TranscriptionUsage
		wantBasis string
		wantUnits cost.Units
	}{{
		name:      "duration usage bills seconds, converted once to millis",
		usage:     &schemas.TranscriptionUsage{Type: "duration", Seconds: sec(12.5)},
		wantBasis: cost.BasisSeconds,
		wantUnits: cost.Units{InputMillis: 12_500},
	}, {
		name: "token usage bills tokens",
		usage: &schemas.TranscriptionUsage{
			Type: "tokens", InputTokens: num(30), OutputTokens: num(7),
		},
		wantBasis: cost.BasisTokens,
		wantUnits: cost.Units{InputTokens: 30, OutputTokens: 7},
	}, {
		// The Type is load-bearing in ONE direction. A duration-billed response
		// that also fills a token field is describing the audio, not selling it
		// by the token.
		name: "duration usage with a token field still bills seconds",
		usage: &schemas.TranscriptionUsage{
			Type: "duration", Seconds: sec(4), InputTokens: num(99),
		},
		wantBasis: cost.BasisSeconds,
		wantUnits: cost.Units{InputMillis: 4_000},
	}, {
		// The revenue-losing case (issue #323 review). TranscriptionUsage.Type
		// is a plain string that no schema guarantees, and a provider adapter
		// may leave it empty while still reporting counts. Requiring
		// Type == "tokens" billed such a response ZERO and counted it UNPRICED.
		// A reported count is what the token rate prices, whatever the label
		// beside it says.
		name: "token counts with an EMPTY type still bill tokens",
		usage: &schemas.TranscriptionUsage{
			InputTokens: num(30), OutputTokens: num(7),
		},
		wantBasis: cost.BasisTokens,
		wantUnits: cost.Units{InputTokens: 30, OutputTokens: 7},
	}, {
		// An empty Type with no counts and no duration is still unpriced: the
		// widened gate bills what a provider reported, and this one reported
		// nothing.
		name:      "an empty type with nothing in it is unpriced",
		usage:     &schemas.TranscriptionUsage{},
		wantBasis: "",
	}, {
		name:      "no usage object at all is unpriced",
		usage:     nil,
		wantBasis: "",
	}, {
		name:      "an empty usage object is unpriced",
		usage:     &schemas.TranscriptionUsage{Type: "duration"},
		wantBasis: "",
	}}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			units, basis := transcriptionUnits(&schemas.BifrostTranscriptionResponse{Usage: tc.usage})
			if basis != tc.wantBasis {
				t.Fatalf("basis = %q, want %q", basis, tc.wantBasis)
			}
			if units != tc.wantUnits {
				t.Fatalf("units = %+v, want %+v", units, tc.wantUnits)
			}
		})
	}
}

// TestTranscriptionUnits_IgnoresTheDurationField is the "observed estimate"
// rule. For several providers bifrost derives BifrostTranscriptionResponse.
// Duration from word timestamps, so it is the gateway's guess at how long the
// audio was, not usage the provider reported. Billing on it charges a project
// for a number the provider never sent.
func TestTranscriptionUnits_IgnoresTheDurationField(t *testing.T) {
	duration := 600.0
	_, basis := transcriptionUnits(&schemas.BifrostTranscriptionResponse{
		Duration: &duration,
		Usage:    &schemas.TranscriptionUsage{Type: "duration"},
	})
	if basis != "" {
		t.Fatalf("basis = %q, want \"\": Duration is an observed estimate and must not bill", basis)
	}
}

// TestSecondsToMillis_RejectsAGarbageDuration guards the ONE float on the money
// path. NaN and either infinity convert to an unspecified int64, and a negative
// duration would credit the project.
func TestSecondsToMillis_RejectsAGarbageDuration(t *testing.T) {
	bad := []float64{
		math.NaN(), math.Inf(1), math.Inf(-1),
		0, -1, -0.5,
		maxBillableAudioSeconds + 1,
		1e18,
		// A duration that rounds to zero milliseconds. (0, true) would hand the
		// caller a SECONDS basis with all-zero Units; updateUsageUnits then
		// re-derives the basis from those zeros, reads tokens, and neither
		// audio counter moves — the request is neither billed nor counted.
		// A non-empty basis must imply a positive quantity in that basis.
		0.0004, 0.0000001,
	}
	for _, v := range bad {
		if got, ok := secondsToMillis(v); ok {
			t.Errorf("secondsToMillis(%v) = (%d, true), want ok=false", v, got)
		}
	}

	good := []struct {
		sec  float64
		want int64
	}{
		{0.001, 1},
		{12.5, 12_500},
		{1.0004, 1000}, // math.Round, not truncation
		{1.0006, 1001}, // math.Round, not truncation
		{maxBillableAudioSeconds, 86_400_000},
	}
	for _, tc := range good {
		got, ok := secondsToMillis(tc.sec)
		if !ok || got != tc.want {
			t.Errorf("secondsToMillis(%v) = (%d, %v), want (%d, true)", tc.sec, got, ok, tc.want)
		}
	}
}

// TestSpeechUnits_SelectsOneBasis pins the fixed precedence for the speech
// route: tokens, then generated seconds, then input characters, then unpriced.
//
// It never sums two of them. gpt-4o-mini-tts publishes BOTH a token price and a
// per-second price upstream, so one response can carry both quantities.
func TestSpeechUnits_SelectsOneBasis(t *testing.T) {
	cases := []struct {
		name      string
		usage     *schemas.SpeechUsage
		wantBasis string
		wantUnits cost.Units
	}{{
		name:      "tokens win over everything else",
		usage:     &schemas.SpeechUsage{InputTokens: 11, OutputTokens: 3, AudioSeconds: 30, InputChars: 500},
		wantBasis: cost.BasisTokens,
		wantUnits: cost.Units{InputTokens: 11, OutputTokens: 3},
	}, {
		name:      "generated seconds beat characters",
		usage:     &schemas.SpeechUsage{AudioSeconds: 30, InputChars: 500},
		wantBasis: cost.BasisSeconds,
		wantUnits: cost.Units{OutputMillis: 30_000},
	}, {
		name:      "characters when that is all there is",
		usage:     &schemas.SpeechUsage{InputChars: 500},
		wantBasis: cost.BasisCharacters,
		wantUnits: cost.Units{InputChars: 500},
	}, {
		// SpeechUsage.AudioSeconds is an INT. A clip shorter than one second
		// reports 0, so the seconds basis cannot be selected for it and the
		// character count of the forwarded text pays instead. That is
		// deliberate: bifrost gives this route no sub-second figure, and a
		// duration nobody reported must not be invented.
		name:      "a sub-second clip reports zero seconds and bills the characters",
		usage:     &schemas.SpeechUsage{AudioSeconds: 0, InputChars: 12},
		wantBasis: cost.BasisCharacters,
		wantUnits: cost.Units{InputChars: 12},
	}, {
		// THE NEXT TWO SHAPES BIFROST CANNOT PRODUCE, and they are here as a
		// guard for a router that is not bifrost, not as a claim about provider
		// behaviour. BifrostSpeechResponse.BackfillParams runs on every speech
		// response and fills Usage.InputChars with the rune count of the input
		// bifrost forwarded, and an empty input is refused before a provider is
		// called. Through the real router a speech response always carries a
		// billable quantity, so the unpriced answer below is only reachable
		// from a fake — including this package's own.
		name:      "an empty usage object is unpriced (no bifrost router produces one)",
		usage:     &schemas.SpeechUsage{},
		wantBasis: "",
	}, {
		name:      "no usage object at all is unpriced (no bifrost router produces one)",
		usage:     nil,
		wantBasis: "",
	}}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			units, basis := speechUnits(&schemas.BifrostSpeechResponse{Usage: tc.usage})
			if basis != tc.wantBasis {
				t.Fatalf("basis = %q, want %q", basis, tc.wantBasis)
			}
			if units != tc.wantUnits {
				t.Fatalf("units = %+v, want %+v", units, tc.wantUnits)
			}
		})
	}
}
