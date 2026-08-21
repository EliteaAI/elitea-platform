// Command sdk-conformance-harness serves the gateway's real /llm router to the
// real elitea-sdk, for scripts/sdk-conformance/conformance.py.
//
// IT IS NOT A DEPLOYMENT. It has no provider, no database, no credential and an
// EMPTY identity secret, and it exposes a control endpoint that changes the
// budget verdict. It binds loopback BY DEFAULT; -addr accepts a wildcard.
//
// Every flag has a default, and the process reads NO environment variable. That
// is deliberate: scripts/env-drift-check.sh compares the names the gateway code
// reads against what the Helm chart can set, so a harness-only variable would
// have to be excused in a PRODUCTION allowlist. The verdict is switched over
// HTTP instead; see internal/preflight/sdkharness.
//
// The listening address is printed to stdout as one line
//
//	SDK_HARNESS_URL=http://127.0.0.1:<port>
//
// before serving starts. The port is chosen by the kernel (:0 by default) so
// the caller never races a fixed port with another run on the same machine.
package main

import (
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/preflight/sdkharness"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:0",
		"listen address; port 0 lets the kernel choose so runs cannot collide")
	projectID := flag.Int("project-id", 4242,
		"the project the driver selects with OpenAI-Organization")
	userID := flag.Int("user-id", 77,
		"the member the edge shim attributes every request to")
	verbose := flag.Bool("verbose", false, "log the handler's own output to stderr")
	flag.Parse()

	var logger *slog.Logger
	if *verbose {
		logger = slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug}))
	}

	server, err := sdkharness.New(sdkharness.Config{
		ProjectID: *projectID,
		UserID:    *userID,
		Logger:    logger,
	})
	if err != nil {
		fmt.Fprintf(os.Stderr, "sdk-conformance-harness: %v\n", err)
		os.Exit(1)
	}
	// This process is short-lived, so the sweep goroutine would die with it
	// anyway. Close it regardless: the leak is a property of New, and a caller
	// that models the contract correctly is the one a reader copies.
	defer server.Close()

	listener, err := net.Listen("tcp", *addr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "sdk-conformance-harness: listen on %s: %v\n", *addr, err)
		os.Exit(1)
	}

	// One machine-readable line, flushed before Serve blocks. The caller waits
	// for it rather than sleeping, so a slow start is a slow start and not a
	// connection refused that reads as a routing failure.
	fmt.Printf("SDK_HARNESS_URL=http://%s\n", listener.Addr().String())
	if f, ok := any(os.Stdout).(interface{ Sync() error }); ok {
		_ = f.Sync()
	}

	srv := &http.Server{
		Handler: server.Handler(),
		// The SSE arm holds a response open, so the write timeout must be
		// generous; the read header timeout stays short because every request
		// here is local.
		ReadHeaderTimeout: 10 * time.Second,
	}
	if err := srv.Serve(listener); err != nil && err != http.ErrServerClosed {
		fmt.Fprintf(os.Stderr, "sdk-conformance-harness: serve: %v\n", err)
		os.Exit(1)
	}
}
