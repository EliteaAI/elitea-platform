package run

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

// ArtifactClient puts one object into a bucket. The real one talks to the
// platform's artifact API; tests hand in a fake.
type ArtifactClient interface {
	Upload(ctx context.Context, bucket, name string, data []byte) error
}

// ArtifactClientFactory builds the client for one invocation from its
// llm_settings — the transport the facade hands over: the callback base URL
// and the bearer it minted. nil means "no transport", and nothing uploads.
type ArtifactClientFactory func(llmSettings map[string]any) (ArtifactClient, error)

// ArtifactSettings is what extract_artifact_settings produced from the
// llm_settings dict: the platform base URL with the LLM suffix stripped, the
// bearer, and the project the bucket belongs to.
type ArtifactSettings struct {
	BaseURL   string
	APIKey    string
	ProjectID string
	APIPath   string
	XSecret   string
}

// DefaultAPIPath is the platform API prefix the artifact routes live under.
const DefaultAPIPath = "/api/v2"

var llmSuffix = regexp.MustCompile(`/llm(/api)?(/v\d+)?/?$`)

// ExtractArtifactSettings is the legacy derivation, verbatim: api_base or
// openai_api_base with `/llm[/api][/vN]` stripped; api_key or
// openai_api_key; the project from organization, openai_organization or
// project_id, in that order.
func ExtractArtifactSettings(llmSettings map[string]any) ArtifactSettings {
	apiBase := firstTruthy(llmSettings["api_base"], llmSettings["openai_api_base"], "")
	apiKey := firstTruthy(llmSettings["api_key"], llmSettings["openai_api_key"], "")
	project := firstTruthy(llmSettings["organization"], llmSettings["openai_organization"], llmSettings["project_id"], "")
	secret := firstTruthy(llmSettings["x_secret"], "secret")
	return ArtifactSettings{
		BaseURL:   llmSuffix.ReplaceAllString(fmt.Sprint(apiBase), ""),
		APIKey:    fmt.Sprint(apiKey),
		ProjectID: fmt.Sprint(project),
		APIPath:   DefaultAPIPath,
		XSecret:   fmt.Sprint(secret),
	}
}

// ArtifactClientFrom is the default factory: nil without BOTH halves of the
// transport (a direct SPI call, the P0 fixtures), else an HTTP client.
// caFile, when set, is trusted for the callback hop — the shell read the
// same ELITEA_DEEPWIKI_TLS_CA_FILE for its `verify=`.
func ArtifactClientFrom(caFile string) ArtifactClientFactory {
	return func(llmSettings map[string]any) (ArtifactClient, error) {
		if !Truthy(llmSettings["api_base"]) && !Truthy(llmSettings["openai_api_base"]) {
			return nil, nil
		}
		if !Truthy(llmSettings["api_key"]) && !Truthy(llmSettings["openai_api_key"]) {
			return nil, nil
		}
		return NewHTTPArtifactClient(ExtractArtifactSettings(llmSettings), caFile)
	}
}

// HTTPArtifactClient uploads through the platform's artifact API:
// POST {base}{api_path}/artifacts/objects/{project}/{bucket}?overwrite=true
// as multipart with the object in the `file` part, bearer-authenticated.
type HTTPArtifactClient struct {
	Settings ArtifactSettings
	Client   *http.Client
}

// NewHTTPArtifactClient validates the settings the way the Python client
// did and builds the transport, trusting caFile when given.
func NewHTTPArtifactClient(settings ArtifactSettings, caFile string) (*HTTPArtifactClient, error) {
	if settings.BaseURL == "" {
		return nil, fmt.Errorf("artifact_settings.base_url is required")
	}
	if settings.APIKey == "" {
		return nil, fmt.Errorf("artifact_settings.api_key is required")
	}
	if settings.APIPath == "" {
		settings.APIPath = DefaultAPIPath
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if caFile != "" {
		pem, err := os.ReadFile(caFile)
		if err != nil {
			return nil, fmt.Errorf("read the callback CA: %w", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(pem) {
			return nil, fmt.Errorf("%s holds no certificate", caFile)
		}
		transport.TLSClientConfig = &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}
	}
	return &HTTPArtifactClient{Settings: settings, Client: &http.Client{Transport: transport, Timeout: 300 * time.Second}}, nil
}

// ObjectsURL is the collection route for a bucket; the bucket is lowercased
// and escaped as one segment.
func (c *HTTPArtifactClient) ObjectsURL(bucket string) string {
	return c.Settings.BaseURL + c.Settings.APIPath + "/artifacts/objects/" + c.Settings.ProjectID + "/" + url.PathEscape(strings.ToLower(bucket))
}

// Upload puts one object, overwriting an existing one. A 403 and every
// other non-2xx are errors carrying the platform's own text, as the Python
// client raised them — the runner reports them in band.
func (c *HTTPArtifactClient) Upload(ctx context.Context, bucket, name string, data []byte) error {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	// No Content-Type on the part, deliberately. The Python client sent
	// none and elitea-main then derives the object's type from the key's
	// extension (.json → application/json, .md → text/markdown), which is
	// what the wiki browser's manifest read depends on. multipart's
	// CreateFormFile would label every part application/octet-stream, the
	// server would keep that, and a manifest served as octet-stream is a
	// wiki the browser cannot see — the local E2E run that found this had
	// every page land and no title.
	header := textproto.MIMEHeader{}
	header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="file"; filename="%s"`, escapeQuotes(name)))
	part, err := writer.CreatePart(header)
	if err != nil {
		return err
	}
	if _, err := part.Write(data); err != nil {
		return err
	}
	if err := writer.Close(); err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.ObjectsURL(bucket)+"?overwrite=true", &body)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+c.Settings.APIKey)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	response, err := c.Client.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	text, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
	// The texts are the Python client's, capitals included: they surface
	// verbatim in the in-band "⚠️ … could not be uploaded" message.
	switch {
	case response.StatusCode == http.StatusForbidden:
		return fmt.Errorf("Not authorized to upload artifact (HTTP 403): %s", clip(string(text), 200)) //nolint:staticcheck // legacy message text
	case response.StatusCode != http.StatusOK && response.StatusCode != http.StatusCreated:
		return fmt.Errorf("Failed to upload artifact: HTTP %d — %s", response.StatusCode, clip(string(text), 500)) //nolint:staticcheck // legacy message text
	}
	return nil
}

// escapeQuotes is multipart's own (unexported) quoting for a filename.
func escapeQuotes(s string) string {
	return strings.NewReplacer("\\", "\\\\", `"`, "\\\"").Replace(s)
}

func clip(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
