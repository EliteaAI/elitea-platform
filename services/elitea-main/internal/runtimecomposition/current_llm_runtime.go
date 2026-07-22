package runtimecomposition

import (
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/llmproxy"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/repos"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/litellm"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
	"github.com/jackc/pgx/v5/pgxpool"
)

const currentLLMResponseHeaderTimeout = 30 * time.Second

// CurrentLLMConfig selects the current runtime_interface_litellm-compatible
// data plane. Project credentials continue to come from Configurations; this
// contract contains only deployment routing and the LiteLLM administration
// credential used to inspect model registrations.
type CurrentLLMConfig struct {
	BaseURL       string
	MasterKeyFile string
}

type CurrentLLMRuntime struct {
	handler   http.Handler
	transport *http.Transport
	masterKey *currentLiteLLMMasterKey
}

func NewCurrentLLMRuntime(
	pool *pgxpool.Pool,
	configurations *CurrentConfigurationsRuntime,
	config CurrentLLMConfig,
) (*CurrentLLMRuntime, error) {
	if configurations == nil || configurations.publicProjectID <= 0 || configurations.scope == nil {
		return nil, errors.New("current Configurations runtime is required")
	}
	return newCurrentLLMRuntime(
		pool,
		configurations.scope,
		configurations.vaultLoader,
		configurations.publicProjectID,
		config,
	)
}

func newCurrentLLMRuntime(
	pool *pgxpool.Pool,
	scope currentPersonalProjectResolver,
	vaults storage.SecretVaultLoader,
	publicProjectID int32,
	config CurrentLLMConfig,
) (*CurrentLLMRuntime, error) {
	if pool == nil || scope == nil || vaults == nil || publicProjectID <= 0 ||
		!validLiteLLMBaseURL(config.BaseURL) || !validPrivateConfigPath(config.MasterKeyFile) {
		return nil, errors.New("current LLM runtime dependencies are required")
	}

	caller, err := NewCurrentLLMCallerResolver(scope)
	if err != nil {
		return nil, err
	}
	membership, err := repos.NewCurrentLLMScopeRepository(pool)
	if err != nil {
		return nil, err
	}
	publicProject, err := NewCurrentLLMPublicProjectResolver(publicProjectID)
	if err != nil {
		return nil, err
	}
	projectKeys, err := storage.NewCurrentProjectLLMKeyResolver(vaults)
	if err != nil {
		return nil, err
	}
	masterKey, err := loadCurrentLiteLLMMasterKey(config.MasterKeyFile)
	if err != nil {
		return nil, err
	}
	defaultTransport, ok := http.DefaultTransport.(*http.Transport)
	if !ok || defaultTransport == nil {
		masterKey.Close()
		return nil, errors.New("current LLM HTTP transport is unavailable")
	}
	transport := defaultTransport.Clone()
	transport.ForceAttemptHTTP2 = true
	transport.MaxIdleConns = 128
	transport.MaxIdleConnsPerHost = 64
	transport.IdleConnTimeout = 90 * time.Second
	transport.ResponseHeaderTimeout = currentLLMResponseHeaderTimeout
	httpClient := &http.Client{Transport: transport}

	admin, err := litellm.NewClient(litellm.ClientConfig{
		BaseURL: config.BaseURL,
	}, masterKey, httpClient)
	if err != nil {
		masterKey.Close()
		transport.CloseIdleConnections()
		return nil, err
	}
	proxy, err := llmproxy.NewHandler(llmproxy.Config{
		PublicPrefix:    llmproxy.CurrentPublicPrefix,
		UpstreamBaseURL: config.BaseURL,
	}, llmproxy.Dependencies{
		Callers:       caller,
		Membership:    membership,
		PublicProject: publicProject,
		ProjectKeys:   projectKeys,
		Models:        admin,
		ModelCatalog:  admin,
		HTTPClient:    httpClient,
	})
	if err != nil {
		masterKey.Close()
		transport.CloseIdleConnections()
		return nil, err
	}
	return &CurrentLLMRuntime{handler: proxy, transport: transport, masterKey: masterKey}, nil
}

func (runtime *CurrentLLMRuntime) Handler() http.Handler {
	if runtime == nil {
		return nil
	}
	return runtime.handler
}

func (runtime *CurrentLLMRuntime) Close() {
	if runtime == nil {
		return
	}
	if runtime.transport != nil {
		runtime.transport.CloseIdleConnections()
	}
	if runtime.masterKey != nil {
		runtime.masterKey.Close()
	}
}

func validLiteLLMBaseURL(raw string) bool {
	if raw == "" || len(raw) > 2048 || strings.ContainsAny(raw, "\r\n\x00") {
		return false
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed == nil || (parsed.Scheme != "http" && parsed.Scheme != "https") ||
		parsed.Host == "" || parsed.Hostname() == "" || parsed.User != nil || parsed.RawQuery != "" ||
		parsed.ForceQuery || parsed.Fragment != "" || parsed.RawPath != "" {
		return false
	}
	return parsed.Path == "" || parsed.Path == "/"
}
