package runtimecomposition

import (
	"context"
	"errors"
	"testing"
)

func TestPublisherSetDrainsEveryPublisherOnOwningCancellation(t *testing.T) {
	first := &publisherRunnerStub{started: make(chan struct{}), stopped: make(chan struct{})}
	second := &publisherRunnerStub{started: make(chan struct{}), stopped: make(chan struct{})}
	publishers, err := newPublisherSet(first, second)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- publishers.Run(ctx) }()
	<-first.started
	<-second.started
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("Run error = %v, want context cancellation", err)
	}
	<-first.stopped
	<-second.stopped
}

func TestPublisherSetPropagatesFailureAndCancelsSibling(t *testing.T) {
	want := errors.New("index publisher failed")
	first := &publisherRunnerStub{started: make(chan struct{}), stopped: make(chan struct{})}
	second := &publisherRunnerStub{started: make(chan struct{}), stopped: make(chan struct{}), err: want}
	publishers, err := newPublisherSet(first, second)
	if err != nil {
		t.Fatal(err)
	}
	if err := publishers.Run(context.Background()); !errors.Is(err, want) {
		t.Fatalf("Run error = %v, want %v", err, want)
	}
	<-first.stopped
	<-second.stopped
}

func TestPublisherSetRejectsIncompleteComposition(t *testing.T) {
	if _, err := newPublisherSet(); err == nil {
		t.Fatal("empty publisher set was accepted")
	}
	if _, err := newPublisherSet(nil); err == nil {
		t.Fatal("nil publisher was accepted")
	}
}

func TestConfiguredPublisherSetRequiresExactIndexEnablement(t *testing.T) {
	validation := &publisherRunnerStub{started: make(chan struct{}), stopped: make(chan struct{})}
	index := &publisherRunnerStub{started: make(chan struct{}), stopped: make(chan struct{})}
	if _, err := newConfiguredPublisherSet(true, validation, nil); err == nil {
		t.Fatal("enabled index dispatch accepted no index publisher")
	}
	if _, err := newConfiguredPublisherSet(false, validation, index); err == nil {
		t.Fatal("disabled index dispatch accepted an index publisher")
	}
	configured, err := newConfiguredPublisherSet(true, validation, index)
	if err != nil {
		t.Fatal(err)
	}
	if len(configured.publishers) != 2 {
		t.Fatalf("configured publishers=%d, want validation and index", len(configured.publishers))
	}
}
