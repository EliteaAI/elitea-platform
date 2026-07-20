package oidc

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/ed25519"
	"crypto/rsa"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"

	coreoidc "github.com/coreos/go-oidc/v3/oidc"
	"github.com/go-jose/go-jose/v4"
)

const (
	defaultJWKSResponseBytes = int64(1 << 20)
	maxJWKSResponseBytes     = int64(4 << 20)
	maxJWKSKeys              = 128
	maxJWKMembers            = 32
	maxNestedJSONDepth       = 64
	maxNestedJSONMembers     = 256
)

// RemoteKeySetConfig is an immutable, already-reviewed metadata snapshot.
// Discovery fetching/reload remains a separate production composition gate;
// this constructor never accepts issuer-controlled metadata implicitly.
type RemoteKeySetConfig struct {
	JWKSURL                    string
	SupportedSigningAlgorithms []string
	RequestTimeout             time.Duration
	MaxResponseBytes           int64
}

// NewRemoteKeySet returns a cached coreos KeySet whose HTTP path is HTTPS-only,
// no-redirect, timed, response-size bounded, and dependency-error classified.
// transport is injectable for deterministic tests; nil uses the Go default.
func NewRemoteKeySet(config RemoteKeySetConfig, transport http.RoundTripper) (coreoidc.KeySet, error) {
	if !validHTTPSURL(config.JWKSURL) {
		return nil, ErrInvalidConfiguration
	}
	if config.RequestTimeout == 0 {
		config.RequestTimeout = defaultRequestTimeout
	}
	if config.RequestTimeout < minRequestTimeout || config.RequestTimeout > maxRequestTimeout {
		return nil, ErrInvalidConfiguration
	}
	if config.MaxResponseBytes == 0 {
		config.MaxResponseBytes = defaultJWKSResponseBytes
	}
	if config.MaxResponseBytes < 4096 || config.MaxResponseBytes > maxJWKSResponseBytes {
		return nil, ErrInvalidConfiguration
	}
	algorithms, ok := normalizedSigningAlgorithms(config.SupportedSigningAlgorithms)
	if !ok {
		return nil, ErrInvalidConfiguration
	}
	if transport == nil {
		transport = http.DefaultTransport
	}
	client := &http.Client{
		Transport: &boundedJWKSTransport{
			base:              transport,
			maxResponseBytes:  config.MaxResponseBytes,
			signingAlgorithms: algorithms,
		},
		Timeout: config.RequestTimeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	ctx := coreoidc.ClientContext(context.Background(), client)
	return coreoidc.NewRemoteKeySet(ctx, config.JWKSURL), nil
}

type boundedJWKSTransport struct {
	base              http.RoundTripper
	maxResponseBytes  int64
	signingAlgorithms []string
}

func (t *boundedJWKSTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if request == nil || request.Method != http.MethodGet || request.URL == nil ||
		!validHTTPSURL(request.URL.String()) {
		return nil, ErrProviderUnavailable
	}
	response, err := t.base.RoundTrip(request)
	if err != nil {
		return nil, ErrProviderUnavailable
	}
	if response == nil || response.Body == nil {
		return nil, ErrProviderUnavailable
	}
	if response.StatusCode != http.StatusOK {
		_ = response.Body.Close()
		return nil, ErrProviderUnavailable
	}
	contentTypes := response.Header.Values("Content-Type")
	if len(contentTypes) != 1 {
		_ = response.Body.Close()
		return nil, ErrProviderUnavailable
	}
	mediaType, _, err := mime.ParseMediaType(contentTypes[0])
	if err != nil || (mediaType != "application/json" && mediaType != "application/jwk-set+json") {
		_ = response.Body.Close()
		return nil, ErrProviderUnavailable
	}
	body, readErr := io.ReadAll(io.LimitReader(response.Body, t.maxResponseBytes+1))
	closeErr := response.Body.Close()
	if readErr != nil || closeErr != nil || int64(len(body)) > t.maxResponseBytes {
		return nil, ErrProviderUnavailable
	}
	if !validBoundedJWKS(body, t.signingAlgorithms) {
		return nil, ErrProviderUnavailable
	}
	response.Body = io.NopCloser(bytes.NewReader(body))
	response.ContentLength = int64(len(body))
	return response, nil
}

func validBoundedJWKS(body []byte, signingAlgorithms []string) bool {
	root, ok := uniqueJSONObject(body, 16)
	if !ok {
		return false
	}
	rawKeys, present := root["keys"]
	if !present {
		return false
	}
	var keys []json.RawMessage
	if err := json.Unmarshal(rawKeys, &keys); err != nil || len(keys) == 0 || len(keys) > maxJWKSKeys {
		return false
	}
	configured := make(map[string]struct{}, len(signingAlgorithms))
	for _, algorithm := range signingAlgorithms {
		configured[algorithm] = struct{}{}
	}
	usable := false
	for _, key := range keys {
		if _, ok := uniqueJSONObject(key, maxJWKMembers); !ok {
			return false
		}
		var webKey jose.JSONWebKey
		if err := json.Unmarshal(key, &webKey); err != nil || !webKey.Valid() || !webKey.IsPublic() {
			return false
		}
		if webKey.Use != "" && webKey.Use != "sig" && webKey.Use != "enc" {
			return false
		}
		if webKey.Use == "enc" {
			continue
		}
		if webKey.Algorithm != "" {
			if _, signingAlgorithm := allowedSigningAlgorithms[webKey.Algorithm]; !signingAlgorithm {
				if webKey.Use == "sig" {
					return false
				}
				continue
			}
			if !keySupportsAlgorithm(webKey, webKey.Algorithm) {
				return false
			}
			if _, wanted := configured[webKey.Algorithm]; wanted {
				usable = true
			}
			continue
		}
		for algorithm := range configured {
			if keySupportsAlgorithm(webKey, algorithm) {
				usable = true
				break
			}
		}
	}
	return usable
}

func uniqueJSONObject(raw []byte, maxMembers int) (map[string]json.RawMessage, bool) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	opening, err := decoder.Token()
	if err != nil || opening != json.Delim('{') {
		return nil, false
	}
	members := make(map[string]json.RawMessage)
	for decoder.More() {
		if len(members) >= maxMembers {
			return nil, false
		}
		token, err := decoder.Token()
		if err != nil {
			return nil, false
		}
		name, ok := token.(string)
		if !ok {
			return nil, false
		}
		if _, duplicate := members[name]; duplicate {
			return nil, false
		}
		var value json.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return nil, false
		}
		if !validUniqueJSONValue(value, 1) {
			return nil, false
		}
		members[name] = value
	}
	closing, err := decoder.Token()
	if err != nil || closing != json.Delim('}') {
		return nil, false
	}
	_, err = decoder.Token()
	return members, errors.Is(err, io.EOF)
}

func validUniqueJSONValue(raw []byte, depth int) bool {
	if depth > maxNestedJSONDepth {
		return false
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if !consumeUniqueJSONValue(decoder, depth) {
		return false
	}
	_, err := decoder.Token()
	return errors.Is(err, io.EOF)
}

func consumeUniqueJSONValue(decoder *json.Decoder, depth int) bool {
	token, err := decoder.Token()
	if err != nil {
		return false
	}
	delimiter, ok := token.(json.Delim)
	if !ok {
		return true
	}
	if depth > maxNestedJSONDepth {
		return false
	}
	switch delimiter {
	case '{':
		seen := make(map[string]struct{})
		for decoder.More() {
			if len(seen) >= maxNestedJSONMembers {
				return false
			}
			member, err := decoder.Token()
			if err != nil {
				return false
			}
			name, ok := member.(string)
			if !ok {
				return false
			}
			if _, duplicate := seen[name]; duplicate {
				return false
			}
			seen[name] = struct{}{}
			if !consumeUniqueJSONValue(decoder, depth+1) {
				return false
			}
		}
		closing, err := decoder.Token()
		return err == nil && closing == json.Delim('}')
	case '[':
		for decoder.More() {
			if !consumeUniqueJSONValue(decoder, depth+1) {
				return false
			}
		}
		closing, err := decoder.Token()
		return err == nil && closing == json.Delim(']')
	default:
		return false
	}
}

func keySupportsAlgorithm(webKey jose.JSONWebKey, algorithm string) bool {
	switch key := webKey.Key.(type) {
	case *rsa.PublicKey:
		return key.N != nil && key.N.BitLen() >= 2048 && key.E >= 3 &&
			(strings.HasPrefix(algorithm, "RS") || strings.HasPrefix(algorithm, "PS"))
	case *ecdsa.PublicKey:
		if key.Curve == nil {
			return false
		}
		switch algorithm {
		case "ES256":
			return key.Curve.Params().BitSize == 256
		case "ES384":
			return key.Curve.Params().BitSize == 384
		case "ES512":
			return key.Curve.Params().BitSize == 521
		default:
			return false
		}
	case ed25519.PublicKey:
		return algorithm == "EdDSA" && len(key) == ed25519.PublicKeySize
	default:
		return false
	}
}
