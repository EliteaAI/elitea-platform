package main

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"
)

type publicLifecycleStub struct {
	started      chan struct{}
	stop         chan struct{}
	shutdownOnce sync.Once
	shutdowns    int
	mu           sync.Mutex
}

func newPublicLifecycleStub() *publicLifecycleStub {
	return &publicLifecycleStub{started: make(chan struct{}), stop: make(chan struct{})}
}

func (s *publicLifecycleStub) ListenAndServe() error {
	close(s.started)
	<-s.stop
	return http.ErrServerClosed
}

func (s *publicLifecycleStub) Shutdown(context.Context) error {
	s.mu.Lock()
	s.shutdowns++
	s.mu.Unlock()
	s.shutdownOnce.Do(func() { close(s.stop) })
	return nil
}

type runtimeLifecycleStub struct {
	started       chan struct{}
	stopped       chan struct{}
	stop          chan struct{}
	stopOnce      sync.Once
	err           error
	drainAtExpiry bool
}

func (s *runtimeLifecycleStub) Run(ctx context.Context) error {
	close(s.started)
	if s.err != nil {
		close(s.stopped)
		return s.err
	}
	select {
	case <-s.stop:
	case <-ctx.Done():
	}
	close(s.stopped)
	return context.Canceled

}

func (s *runtimeLifecycleStub) Shutdown(ctx context.Context) error {
	if s.drainAtExpiry {
		<-ctx.Done()
	}
	s.stopOnce.Do(func() {
		if s.stop != nil {
			close(s.stop)
		}
	})
	select {
	case <-s.stopped:
		return ctx.Err()
	case <-ctx.Done():
		<-s.stopped
		return ctx.Err()
	}
}

func TestServeApplicationReturnsAtOneSharedDrainDeadline(t *testing.T) {
	public := newPublicLifecycleStub()
	runtime := &runtimeLifecycleStub{
		started:       make(chan struct{}),
		stopped:       make(chan struct{}),
		stop:          make(chan struct{}),
		drainAtExpiry: true,
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	start := time.Now()
	go func() { done <- serveApplication(ctx, public, runtime, 50*time.Millisecond) }()
	<-public.started
	<-runtime.started
	cancel()
	err := <-done
	elapsed := time.Since(start)
	if !errors.Is(err, ErrApplicationDrainTimeout) {
		t.Fatalf("drain error = %v, want %v", err, ErrApplicationDrainTimeout)
	}
	if elapsed > 500*time.Millisecond {
		t.Fatalf("bounded drain returned after %s", elapsed)
	}
	select {
	case <-runtime.stopped:
	default:
		t.Fatal("serveApplication returned before the runtime released ownership")
	}
}

func TestServeApplicationDrainsPublicAndRuntimeOnCancellation(t *testing.T) {
	public := newPublicLifecycleStub()
	runtime := &runtimeLifecycleStub{started: make(chan struct{}), stopped: make(chan struct{}), stop: make(chan struct{})}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- serveApplication(ctx, public, runtime, time.Second) }()
	<-public.started
	<-runtime.started
	cancel()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	<-runtime.stopped
	public.mu.Lock()
	defer public.mu.Unlock()
	if public.shutdowns != 1 {
		t.Fatalf("public shutdown calls = %d, want 1", public.shutdowns)
	}
}

func TestServeApplicationPropagatesRuntimeFailureAndSupportsDisabledRuntime(t *testing.T) {
	want := errors.New("runtime failed")
	public := newPublicLifecycleStub()
	runtime := &runtimeLifecycleStub{started: make(chan struct{}), stopped: make(chan struct{}), stop: make(chan struct{}), err: want}
	if err := serveApplication(context.Background(), public, runtime, time.Second); !errors.Is(err, want) {
		t.Fatalf("failure error = %v, want %v", err, want)
	}

	public = newPublicLifecycleStub()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- serveApplication(ctx, public, nil, time.Second) }()
	<-public.started
	cancel()
	if err := <-done; err != nil {
		t.Fatalf("disabled runtime lifecycle error = %v", err)
	}
}

func TestConfiguredAuthConfigPathIsExplicitAndBounded(t *testing.T) {
	for name, test := range map[string]struct {
		lookup  func(string) (string, bool)
		path    string
		enabled bool
		wantErr bool
	}{
		"unset": {
			lookup: func(string) (string, bool) { return "", false },
		},
		"explicit empty": {
			lookup:  func(string) (string, bool) { return "", true },
			wantErr: true,
		},
		"configured": {
			lookup:  func(string) (string, bool) { return "/run/config/auth/form.yaml", true },
			path:    "/run/config/auth/form.yaml",
			enabled: true,
		},
		"whitespace": {
			lookup:  func(string) (string, bool) { return " /run/config/auth/form.yaml", true },
			wantErr: true,
		},
		"control": {
			lookup:  func(string) (string, bool) { return "/run/config/auth/form.yaml\nspoof", true },
			wantErr: true,
		},
		"oversized": {
			lookup:  func(string) (string, bool) { return strings.Repeat("a", maxAuthConfigPathBytes+1), true },
			wantErr: true,
		},
		"nil lookup": {wantErr: true},
	} {
		t.Run(name, func(t *testing.T) {
			path, enabled, err := configuredAuthConfigPath(test.lookup)
			if (err != nil) != test.wantErr || path != test.path || enabled != test.enabled {
				t.Fatalf("path=%q enabled=%v err=%v", path, enabled, err)
			}
		})
	}
}
