package executions

import (
	"context"
	"sync"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

const (
	defaultMaxActiveSSEStreams             = 128
	defaultMaxActiveSSEStreamsPerPrincipal = 4
	defaultMaxActiveSSEStreamsPerProject   = 32
)

// sseAdmissionGate bounds long-lived replay loops independently of ordinary
// request rate limiting. It is intentionally process-local: every replica has
// a fixed resource ceiling, while the dedicated replay pool protects output
// settlement from aggregate cross-replica SSE load.
type sseAdmissionGate struct {
	mu             sync.Mutex
	active         int
	globalLimit    int
	principalLimit int
	projectLimit   int
	byPrincipal    map[string]int
	byProject      map[string]int
}

func newSSEAdmissionGate(globalLimit, principalLimit, projectLimit int) *sseAdmissionGate {
	if globalLimit <= 0 || principalLimit <= 0 || projectLimit <= 0 || principalLimit > globalLimit || projectLimit > globalLimit {
		return nil
	}
	return &sseAdmissionGate{
		globalLimit:    globalLimit,
		principalLimit: principalLimit,
		projectLimit:   projectLimit,
		byPrincipal:    make(map[string]int),
		byProject:      make(map[string]int),
	}
}

func (g *sseAdmissionGate) acquire(principalID, projectID string) (func(), bool) {
	if g == nil || principalID == "" || projectID == "" {
		return nil, false
	}
	g.mu.Lock()
	if g.active >= g.globalLimit || g.byPrincipal[principalID] >= g.principalLimit || g.byProject[projectID] >= g.projectLimit {
		g.mu.Unlock()
		return nil, false
	}
	g.active++
	g.byPrincipal[principalID]++
	g.byProject[projectID]++
	g.mu.Unlock()

	var once sync.Once
	return func() {
		once.Do(func() {
			g.mu.Lock()
			g.active--
			decrementSSEAdmissionCount(g.byPrincipal, principalID)
			decrementSSEAdmissionCount(g.byProject, projectID)
			g.mu.Unlock()
		})
	}, true
}

func decrementSSEAdmissionCount(counts map[string]int, key string) {
	if counts[key] <= 1 {
		delete(counts, key)
		return
	}
	counts[key]--
}

func ssePrincipalID(ctx context.Context) string {
	if principal, ok := auth.RuntimePrincipalFromContext(ctx); ok {
		return principal.ID
	}
	// Production authorization fails before admission without provenance. This
	// stable fallback keeps the transport handler independently testable while
	// still sharing one conservative bucket for any custom authorizer.
	return "unprovenanced"
}
