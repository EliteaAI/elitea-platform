// elitea-subapp-host serves the provider SPI for one sub-application.
//
//	ELITEA_SUBAPP=deepwiki|echo     which application (default: deepwiki)
//	ELITEA_<APP>_RUNNER=unavailable|echo|fixture (fixture: DeepWiki only)
//	ELITEA_<APP>_*                  the host settings under the app's prefix
//
// One binary, one application per process; the prefix keeps each
// application's settings in its own namespace, exactly as the Python shell
// did for DeepWiki. Mutual TLS is on whenever a client CA is configured:
// the listener then requires and verifies a client certificate at the
// handshake, and the host trusts its own handshake (ADR-0023 H1 — the
// Python shell looked for an ASGI extension uvicorn never populated, and
// refused every authenticated hop until the standalone stack found it).
package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-subapp-host/internal/apps/deepwiki"
	deepwikirun "github.com/EliteaAI/elitea-platform/services/elitea-subapp-host/internal/apps/deepwiki/run"
	"github.com/EliteaAI/elitea-platform/services/elitea-subapp-host/internal/apps/echo"
	"github.com/EliteaAI/elitea-platform/services/elitea-subapp-host/internal/spi"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)
	if err := run(logger); err != nil {
		logger.Error("elitea-subapp-host stopped with an error", "error", err)
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	app, settings, err := compose(os.LookupEnv)
	if err != nil {
		return err
	}
	server, err := spi.NewServer(settings, app, logger)
	if err != nil {
		return err
	}
	server.Start(ctx)
	defer server.Stop()

	httpServer := &http.Server{
		Addr:              settings.ListenAddr,
		Handler:           server,
		ReadHeaderTimeout: 10 * time.Second,
		// No WriteTimeout: a poll is short, but an invoke may hold a long
		// body, and a deadline here would truncate it with nothing logged.
	}
	if settings.TLSCertFile != "" {
		tlsConfig, err := listenerTLS(settings)
		if err != nil {
			return err
		}
		httpServer.TLSConfig = tlsConfig
	}
	errs := make(chan error, 1)
	go func() {
		logger.Info("elitea-subapp-host listening",
			"app", app.Name, "runner", app.Runner.Name(), "addr", settings.ListenAddr,
			"tls", settings.TLSCertFile != "", "mtls", settings.MTLSRequired(), "identity_verified", settings.IdentitySecret != "")
		if httpServer.TLSConfig != nil {
			errs <- httpServer.ListenAndServeTLS("", "")
		} else {
			errs <- httpServer.ListenAndServe()
		}
	}()
	select {
	case <-ctx.Done():
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutdownCancel()
		return httpServer.Shutdown(shutdownCtx)
	case err := <-errs:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	}
}

// compose picks the application and its runner from the environment.
func compose(lookup spi.Lookup) (spi.App, spi.Settings, error) {
	name, _ := lookup("ELITEA_SUBAPP")
	name = strings.ToLower(strings.TrimSpace(name))
	if name == "" {
		name = "deepwiki"
	}
	var prefix string
	switch name {
	case "deepwiki":
		prefix = deepwiki.EnvPrefix
	case "echo":
		prefix = echo.EnvPrefix
	default:
		return spi.App{}, spi.Settings{}, fmt.Errorf("%w: ELITEA_SUBAPP=%q is not a known sub-application (deepwiki, echo)", spi.ErrConfig, name)
	}
	settings, err := spi.SettingsFromEnv(prefix, lookup)
	if err != nil {
		return spi.App{}, spi.Settings{}, err
	}
	runnerName, _ := lookup(prefix + "RUNNER")
	runnerName = strings.TrimSpace(runnerName)
	if runnerName == "" {
		runnerName = "unavailable"
	}
	stepRaw, _ := lookup(prefix + "FIXTURE_STEP_SECONDS")
	step := time.Second
	if stepRaw != "" {
		parsed, err := time.ParseDuration(strings.TrimSpace(stepRaw) + "s")
		if err != nil || parsed < 0 {
			return spi.App{}, spi.Settings{}, fmt.Errorf("%w: %sFIXTURE_STEP_SECONDS must be a number of seconds, got %q", spi.ErrConfig, prefix, stepRaw)
		}
		step = parsed
	}
	var runner spi.Runner
	switch runnerName {
	case "unavailable":
		runner = spi.UnavailableRunner{}
	case "echo":
		runner = spi.EchoRunner{Step: step}
	case "fixture":
		// The DeepWiki composition-and-upload path over canned engine results
		// (the Python shell's fixture runner, ported): what the browser
		// journeys run against.
		if name != "deepwiki" {
			return spi.App{}, spi.Settings{}, fmt.Errorf("%w: %sRUNNER=fixture is DeepWiki's runner, not %s's", spi.ErrConfig, prefix, name)
		}
		runner = deepwikirun.NewFixtureRunner(settings, step)
	default:
		// "legacy" is the Python shell's engine runner; reaching that engine
		// from this host is ADR-0023 H2 and is refused, loudly, until it
		// lands — a host that asked for an engine and did not get it must not
		// come up looking healthy.
		return spi.App{}, spi.Settings{}, fmt.Errorf("%w: %sRUNNER=%q is not served by this host (unavailable, echo, fixture)", spi.ErrConfig, prefix, runnerName)
	}
	switch name {
	case "deepwiki":
		return deepwiki.App(runner), settings, nil
	default:
		app := echo.App(step)
		app.Runner = runner
		if runnerName == "unavailable" {
			app.Runner = spi.UnavailableRunner{}
		}
		return app, settings, nil
	}
}

// listenerTLS builds the listener's TLS: the server certificate, and — with
// a client CA — RequireAndVerifyClientCert, the mutual-TLS terminus.
func listenerTLS(settings spi.Settings) (*tls.Config, error) {
	certificate, err := tls.LoadX509KeyPair(settings.TLSCertFile, settings.TLSKeyFile)
	if err != nil {
		return nil, fmt.Errorf("load the server certificate: %w", err)
	}
	cfg := &tls.Config{Certificates: []tls.Certificate{certificate}, MinVersion: tls.VersionTLS12}
	if settings.TLSCAFile != "" {
		pem, err := os.ReadFile(settings.TLSCAFile)
		if err != nil {
			return nil, fmt.Errorf("read the client CA: %w", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(pem) {
			return nil, fmt.Errorf("%w: %s holds no certificate", spi.ErrConfig, settings.TLSCAFile)
		}
		cfg.ClientCAs = pool
		cfg.ClientAuth = tls.RequireAndVerifyClientCert
	}
	return cfg, nil
}
