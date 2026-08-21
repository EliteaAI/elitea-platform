// audio.go — the /llm/v1/audio surface: text-to-speech and speech-to-text
// (issue #323).
//
// WHY THIS FILE EXISTS. The retired LiteLLM proxy served /v1/audio/speech and
// /v1/audio/transcriptions, and pylon-indexer's voice paths call them directly
// (indexer_tts.py, indexer_asr_whisper.py). Nothing replaced those two routes
// when LiteLLM was removed, so the indexer kept a LiteLLM process of its own to
// answer them. That process is a SECOND LLM data plane: it applies no budget,
// bills nothing, and resolves credentials from a registry the platform no
// longer writes. These two routes exist so it can be deleted.
//
// The two routes follow the same order every /llm route follows, and the order
// is a correctness rule, not a style: decode, then mapModel, then checkBudget,
// then dispatch, then updateUsage. mapModel must run first so the provider
// never sees a caller-authored model title and so the cost tables are keyed by
// the provider's own model name (CLAUDE.md, modelmap.go).
//
// TWO DELIBERATE LIMITS, both stated here rather than discovered later:
//
//  1. Neither route streams. The speech route answers one complete audio body.
//     The pylon TTS client reads the response with `iter_content`, so a unary
//     body still arrives as a stream of chunks to it; what it loses is
//     first-byte latency, not audio. A streaming speech route needs the same
//     detached-drain billing machinery the chat stream has, and that is a
//     larger change than this one.
//  2. Unknown request fields are dropped, exactly as they are on every other
//     JSON route here (see decodeJSON). bifrost carries them in ExtraParams,
//     which only its fasthttp integrations layer populates, and this gateway
//     decodes its own bodies. For TTS this drops the ElevenLabs
//     `previous_text` / `next_text` prosody hints. `instructions`, `voice`,
//     `speed` and `response_format` are first-class fields and DO travel.
package llmproxy

import (
	"expvar"
	"mime/multipart"
	"net/http"
	"strconv"

	"github.com/maximhq/bifrost/core/providers/openai"
	"github.com/maximhq/bifrost/core/schemas"
)

// MetricAudioUnpriced counts audio responses the gateway could not price.
//
// The cost calculator prices TOKENS. An audio provider may instead report
// duration-based usage (`"type":"duration"` with a seconds count), or no usage
// at all. Such a response is dispatched, delivered and billed as zero.
//
// That is a real gap in the money path, so it gets a number an operator can
// alarm on rather than a silent zero. Inventing a per-second price here would
// be worse: it would put a made-up figure onto the authoritative counter, and
// the counter is what the budget gate reads back.
const MetricAudioUnpriced = "gateway_audio_unpriced_total"

var audioUnpriced = expvar.NewInt(MetricAudioUnpriced)

// AudioMetricNames returns the names of this file's counters, in a fixed order,
// for the composition root's /metrics allowlist. It mirrors
// ModelMapMetricNames: a counter this package publishes reaches the scrape
// surface through ONE named path, never a name copied into a second file.
func AudioMetricNames() []string {
	return []string{MetricAudioUnpriced}
}

// Speech handles POST /llm/v1/audio/speech (text-to-speech).
//
// The success body is the raw audio the provider returned, NOT JSON. That is
// the OpenAI contract and the one the pylon TTS client reads. Errors stay
// OpenAI-shaped JSON like every other route (spec §2.5).
func (h *Handler) Speech(w http.ResponseWriter, r *http.Request) {
	var req openai.OpenAISpeechRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	ctx, ok := h.newContext(w, r)
	if !ok {
		return
	}
	bifReq := req.ToBifrostSpeechRequest(ctx)

	if !h.mapModel(w, ctx, &bifReq.Provider, &bifReq.Model) {
		return
	}
	provider, model := providerModelFromSpeechReq(bifReq)
	if !h.checkBudget(w, ctx, model) {
		return
	}

	resp, bErr := h.router.SpeechRequest(ctx, bifReq)
	if bErr != nil {
		h.writeOpenAIError(w, bErr)
		return
	}
	if resp == nil {
		writeError(w, http.StatusBadGateway, "api_error",
			"the speech provider returned no audio", "upstream_empty_response")
		return
	}

	writeAudio(w, resp.Audio, speechContentType(req.ResponseFormat))

	in, out := usageFromSpeechResponse(resp)
	if in == 0 && out == 0 {
		audioUnpriced.Add(1)
		h.logger.WarnContext(ctx, "audio: the speech response carries no token usage; the request bills zero",
			"provider", provider, "model", model, "metric", MetricAudioUnpriced)
		return
	}
	h.updateUsage(ctx, provider, model, in, out, identityProjectFromCtx(ctx), identityUserFromCtx(ctx))
}

// Transcription handles POST /llm/v1/audio/transcriptions and
// POST /llm/v1/audio/translations (speech-to-text), both multipart.
//
// The two OpenAI routes share one bifrost request type. They are mounted
// separately so a caller that posts to /translations gets an answer instead of
// a 404; the request reaches the provider under the model the project
// configured, and the provider decides what the model does with it.
func (h *Handler) Transcription(w http.ResponseWriter, r *http.Request) {
	// The identity check runs BEFORE the body is parsed. newContext reads
	// headers only, so the order is free, and an audio upload is the largest
	// body this gateway accepts: buffering 32 MiB for a request whose identity
	// signature does not verify is work done for a caller that gets a 403.
	//
	// The image multipart routes still parse first. Copy THIS order into a new
	// route, not that one.
	ctx, ok := h.newContext(w, r)
	if !ok {
		return
	}
	form, ok := parseMultipart(w, r)
	if !ok {
		return
	}
	req, err := buildTranscriptionRequest(form)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request_error", err.Error(), "")
		return
	}
	bifReq := req.ToBifrostTranscriptionRequest(ctx)
	// ToBifrostTranscriptionRequest copies File but not Filename, and the
	// provider needs the extension to know the container format. Carry it.
	if bifReq.Input != nil {
		bifReq.Input.Filename = req.Filename
	}

	if !h.mapModel(w, ctx, &bifReq.Provider, &bifReq.Model) {
		return
	}
	provider, model := providerModelFromTranscriptionReq(bifReq)
	if !h.checkBudget(w, ctx, model) {
		return
	}

	resp, bErr := h.router.TranscriptionRequest(ctx, bifReq)
	if bErr != nil {
		h.writeOpenAIError(w, bErr)
		return
	}
	if resp == nil {
		writeError(w, http.StatusBadGateway, "api_error",
			"the transcription provider returned no result", "upstream_empty_response")
		return
	}

	writeTranscription(w, resp)

	in, out := usageFromTranscriptionResponse(resp)
	if in == 0 && out == 0 {
		audioUnpriced.Add(1)
		h.logger.WarnContext(ctx, "audio: the transcription response carries no token usage; the request bills zero",
			"provider", provider, "model", model, "metric", MetricAudioUnpriced)
		return
	}
	h.updateUsage(ctx, provider, model, in, out, identityProjectFromCtx(ctx), identityUserFromCtx(ctx))
}

// buildTranscriptionRequest constructs an OpenAITranscriptionRequest from a
// parsed multipart form, mirroring the field contract of the upstream fasthttp
// parser. `file` and `model` are required; every other field is copied only
// when present.
func buildTranscriptionRequest(form *multipart.Form) (*openai.OpenAITranscriptionRequest, error) {
	req := &openai.OpenAITranscriptionRequest{}

	model, err := requiredValue(form, "model")
	if err != nil {
		return nil, err
	}
	req.Model = model

	headers := form.File["file"]
	if len(headers) == 0 {
		return nil, errRequired("file")
	}
	data, err := readFileHeader(headers[0])
	if err != nil {
		return nil, err
	}
	if len(data) == 0 {
		return nil, errRequired("file")
	}
	req.File = data
	req.Filename = headers[0].Filename

	if v, ok := stringValue(form, "language"); ok {
		req.Language = &v
	}
	if v, ok := stringValue(form, "prompt"); ok {
		req.Prompt = &v
	}
	if v, ok := stringValue(form, "response_format"); ok {
		req.ResponseFormat = &v
	}
	if v, ok := stringValue(form, "file_format"); ok {
		req.Format = &v
	}
	if v, ok := stringValue(form, "temperature"); ok {
		f, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return nil, wrapInvalid("temperature")
		}
		req.Temperature = &f
	}
	// Both spellings reach the same field: OpenAI's own clients send the
	// repeated-key form `timestamp_granularities[]`, and hand-built callers
	// send the bare name.
	if g := form.Value["timestamp_granularities[]"]; len(g) > 0 {
		req.TimestampGranularities = g
	} else if g := form.Value["timestamp_granularities"]; len(g) > 0 {
		req.TimestampGranularities = g
	}
	if inc := form.Value["include[]"]; len(inc) > 0 {
		req.Include = inc
	} else if inc := form.Value["include"]; len(inc) > 0 {
		req.Include = inc
	}
	if fb := form.Value["fallbacks"]; len(fb) > 0 {
		req.Fallbacks = fb
	}
	return req, nil
}

// speechAudioContentTypes maps an OpenAI speech `response_format` onto the MIME
// type of the body the provider returns.
//
// "pcm" is headerless 24 kHz 16-bit little-endian mono, which has no registered
// MIME type of its own; audio/L16 is the closest standard name and carries the
// rate and channel count that a caller would otherwise have to assume.
var speechAudioContentTypes = map[string]string{
	"mp3":  "audio/mpeg",
	"opus": "audio/opus",
	"aac":  "audio/aac",
	"flac": "audio/flac",
	"wav":  "audio/wav",
	"pcm":  "audio/L16; rate=24000; channels=1",
}

// speechContentType resolves the response Content-Type for a speech request.
// An absent format is mp3, which is the OpenAI default. An unrecognised format
// is served as opaque bytes rather than mislabelled.
func speechContentType(format string) string {
	if format == "" {
		return speechAudioContentTypes["mp3"]
	}
	if ct, ok := speechAudioContentTypes[format]; ok {
		return ct
	}
	return "application/octet-stream"
}

// transcriptionTextFormats are the transcription response formats whose body is
// plain text, not JSON. bifrost records the format the provider actually served
// on the response, and the body for these is the transcript itself.
var transcriptionTextFormats = map[string]bool{
	"text": true,
	"srt":  true,
	"vtt":  true,
}

// writeAudio writes a raw audio body with the response-header hygiene every
// other write on this surface applies.
func writeAudio(w http.ResponseWriter, audio []byte, contentType string) {
	finish(w.Header())
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.Itoa(len(audio)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(audio)
}

// writeTranscription writes a transcription response in the shape the caller's
// response_format asked for: plain text for text/srt/vtt, JSON otherwise.
func writeTranscription(w http.ResponseWriter, resp *schemas.BifrostTranscriptionResponse) {
	if resp.ResponseFormat != nil && transcriptionTextFormats[*resp.ResponseFormat] {
		finish(w.Header())
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(resp.Text))
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// providerModelFromSpeechReq extracts provider and model from a
// BifrostSpeechRequest.
func providerModelFromSpeechReq(req *schemas.BifrostSpeechRequest) (string, string) {
	if req == nil {
		return "", ""
	}
	return string(req.Provider), req.Model
}

// providerModelFromTranscriptionReq extracts provider and model from a
// BifrostTranscriptionRequest.
func providerModelFromTranscriptionReq(req *schemas.BifrostTranscriptionRequest) (string, string) {
	if req == nil {
		return "", ""
	}
	return string(req.Provider), req.Model
}

// usageFromSpeechResponse extracts (inputTokens, outputTokens) from a speech
// response. InputChars is deliberately NOT converted into tokens: the cost
// tables price tokens, and a characters-to-tokens ratio invented here would
// reach the authoritative budget counter as if it were measured.
func usageFromSpeechResponse(resp *schemas.BifrostSpeechResponse) (int64, int64) {
	if resp == nil || resp.Usage == nil {
		return 0, 0
	}
	return int64(resp.Usage.InputTokens), int64(resp.Usage.OutputTokens)
}

// usageFromTranscriptionResponse extracts (inputTokens, outputTokens) from a
// transcription response.
//
// The usage object carries a Type: "tokens" or "duration". Only the token form
// can be priced here. A duration-billed response (whisper-1 is priced per
// minute) reports Seconds and no tokens, and returns (0, 0) — the caller counts
// that on MetricAudioUnpriced.
func usageFromTranscriptionResponse(resp *schemas.BifrostTranscriptionResponse) (int64, int64) {
	if resp == nil || resp.Usage == nil {
		return 0, 0
	}
	var in, out int64
	if resp.Usage.InputTokens != nil {
		in = int64(*resp.Usage.InputTokens)
	}
	if resp.Usage.OutputTokens != nil {
		out = int64(*resp.Usage.OutputTokens)
	}
	return in, out
}
