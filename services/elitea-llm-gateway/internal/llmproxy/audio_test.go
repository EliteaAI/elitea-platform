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
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
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

// TestUsageFromTranscriptionResponse_DurationBilledIsZero pins the money-path
// limit this surface has. whisper-1 is billed per minute, and the cost tables
// price tokens, so a duration-only usage object yields no billable amount. The
// handler counts that on MetricAudioUnpriced; it must never be turned into a
// token count here, because an invented count reaches the authoritative budget
// counter as if it were measured.
func TestUsageFromTranscriptionResponse_DurationBilledIsZero(t *testing.T) {
	seconds := 12.5
	in, out := usageFromTranscriptionResponse(&schemas.BifrostTranscriptionResponse{
		Usage: &schemas.TranscriptionUsage{Type: "duration", Seconds: &seconds},
	})
	if in != 0 || out != 0 {
		t.Fatalf("usage = (%d, %d), want (0, 0) for duration-based billing", in, out)
	}

	tokensIn, tokensOut := 30, 7
	in, out = usageFromTranscriptionResponse(&schemas.BifrostTranscriptionResponse{
		Usage: &schemas.TranscriptionUsage{
			Type: "tokens", InputTokens: &tokensIn, OutputTokens: &tokensOut,
		},
	})
	if in != 30 || out != 7 {
		t.Fatalf("usage = (%d, %d), want (30, 7)", in, out)
	}
}
