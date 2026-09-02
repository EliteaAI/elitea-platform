package run

import (
	"context"

	"github.com/EliteaAI/elitea-platform/services/elitea-subapp-host/internal/engine"
	"github.com/EliteaAI/elitea-platform/services/elitea-subapp-host/internal/spi"
)

// DeepWiki over the engine sidecar (ADR-0023 H2). The analysis engine — the
// copied Python tool layer with its ~1.1 GB dependency closure — stays in
// Python and listens on a Unix socket next to this host. This host keeps
// the SPI, the parameter merge, the egress check, composition and upload.
//
// The socket protocol itself moved to internal/engine in stage H4c: it is
// the host's transport, not DeepWiki's. What is DeepWiki's, and stays here,
// is which tools the sidecar serves and how its results are composed.

// EngineTools are the tools the sidecar serves; everything else is refused
// at the door, as the fixture table does.
var EngineTools = []string{"generate_wiki", "ask", "deep_research"}

// EngineLabel names the engine in the messages a caller reads.
const EngineLabel = "DeepWiki"

// EngineClient speaks the sidecar protocol over a Unix socket.
type EngineClient = engine.Client

// NewEngineClient builds the client for DeepWiki's sidecar.
func NewEngineClient(socket string) *EngineClient {
	return engine.NewClient(socket, EngineLabel)
}

// NewEngineRunner is the shared runner over the sidecar's tools, with the
// host's egress policy and callback CA.
func NewEngineRunner(settings spi.Settings) *Runner {
	client := NewEngineClient(settings.EngineSocket)
	tools := map[string]Tool{}
	for _, name := range EngineTools {
		tool := name
		tools[tool] = func(ctx context.Context, arguments map[string]any, tc *spi.Context) (map[string]any, error) {
			return client.Invoke(ctx, tool, arguments, tc)
		}
	}
	return &Runner{
		RunnerName: "legacy",
		Tools:      tools,
		Egress:     spi.ParseEgressPolicy(settings.GitAllowlist),
		Artifacts:  ArtifactClientFrom(settings.TLSCAFile),
	}
}
