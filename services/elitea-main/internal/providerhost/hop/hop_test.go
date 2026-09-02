package hop_test

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/providerhost/hop"
)

// The message has to name the setting an operator would edit.
//
// Both hops previously failed with a message that named neither the variable
// nor the value — "llmproxy: target url missing scheme or host" and "invalid
// DeepWiki proxy" — which tells an operator with twenty-odd variables nothing
// about which one to look at.
func TestARefusedTargetNamesTheSettingAndTheValue(t *testing.T) {
	_, err := hop.ParseTarget("elitea-deepwiki:8443", hop.TargetOptions{
		EnvName: "DEEPWIKI_BASE_URL",
	})
	if err == nil {
		t.Fatal("a URL with no scheme was accepted")
	}
	if !errors.Is(err, hop.ErrInvalidTarget) {
		t.Errorf("error is not ErrInvalidTarget: %v", err)
	}
	if !strings.Contains(err.Error(), "DEEPWIKI_BASE_URL") {
		t.Errorf("the message does not name the setting: %v", err)
	}
	if !strings.Contains(err.Error(), "elitea-deepwiki:8443") {
		t.Errorf("the message does not name the value: %v", err)
	}
}

// RequireTLS differs between the two hops ON PURPOSE, and both directions are
// pinned so that "unifying" them fails here rather than in production.
func TestRequireTLSIsPerHop(t *testing.T) {
	plain := "http://elitea-deepwiki:8080"

	if _, err := hop.ParseTarget(plain, hop.TargetOptions{
		EnvName:    "DEEPWIKI_BASE_URL",
		RequireTLS: true,
	}); err == nil {
		t.Error("a plain-HTTP target was accepted for a peer that refuses non-mTLS traffic")
	}

	// The /llm gateway is reachable over plain HTTP in a development stack.
	// Refusing it here would break a supported configuration.
	if _, err := hop.ParseTarget(plain, hop.TargetOptions{
		EnvName: "LLM_GATEWAY_URL",
	}); err != nil {
		t.Errorf("a plain-HTTP target was refused for a hop that permits it: %v", err)
	}
}

func TestAValidTargetIsReturnedWhole(t *testing.T) {
	target, err := hop.ParseTarget("https://elitea-deepwiki:8443/base", hop.TargetOptions{
		EnvName:    "DEEPWIKI_BASE_URL",
		RequireTLS: true,
	})
	if err != nil {
		t.Fatalf("a valid target was refused: %v", err)
	}
	if target.Scheme != "https" || target.Host != "elitea-deepwiki:8443" || target.Path != "/base" {
		t.Errorf("target was altered: %#v", target)
	}
}

// deadlineRecorder reports whether the deadline was cleared, and can refuse
// the way a ResponseWriter without deadline support does.
type deadlineRecorder struct {
	http.ResponseWriter
	cleared   bool
	supported bool
}

func (d *deadlineRecorder) SetWriteDeadline(t time.Time) error {
	if !d.supported {
		return http.ErrNotSupported
	}
	if t.IsZero() {
		d.cleared = true
	}
	return nil
}

func TestTheWriteDeadlineIsCleared(t *testing.T) {
	recorder := &deadlineRecorder{ResponseWriter: httptest.NewRecorder(), supported: true}
	hop.ClearWriteDeadline(recorder, nil)
	if !recorder.cleared {
		t.Fatal("the write deadline was not cleared; a WriteTimeout would truncate a long response mid-stream")
	}
}

// A ResponseWriter that cannot set a deadline is not an error: the deadline it
// cannot set is one it does not have. httptest.ResponseRecorder is exactly
// this, so treating ErrNotSupported as a failure would make every test that
// proxies through a recorder log a warning.
func TestAWriterWithoutDeadlineSupportIsNotAnError(t *testing.T) {
	recorder := &deadlineRecorder{ResponseWriter: httptest.NewRecorder(), supported: false}
	hop.ClearWriteDeadline(recorder, nil)
	if recorder.cleared {
		t.Fatal("the recorder reported a clear it said it did not support")
	}
}
