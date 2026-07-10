package shadow_test

import (
	"testing"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/shadow"
)

func TestMetrics_Record(t *testing.T) {
	m := shadow.NewMetrics(100)

	m.Record(shadow.CompareResult{
		StatusMatch:   true,
		BodyMatch:     true,
		NewLatency:    10 * time.Millisecond,
		LegacyLatency: 20 * time.Millisecond,
	})
	m.Record(shadow.CompareResult{
		StatusMatch:   true,
		BodyMatch:     false,
		NewLatency:    15 * time.Millisecond,
		LegacyLatency: 25 * time.Millisecond,
	})
	m.Record(shadow.CompareResult{
		StatusMatch:   false,
		BodyMatch:     true,
		NewLatency:    5 * time.Millisecond,
		LegacyLatency: 30 * time.Millisecond,
		Error:         "timeout",
	})

	stats := m.Stats()
	if stats.Total != 3 {
		t.Errorf("expected total 3, got %d", stats.Total)
	}
	if stats.FullMatches != 1 {
		t.Errorf("expected 1 full match, got %d", stats.FullMatches)
	}
	if stats.BodyMismatches != 1 {
		t.Errorf("expected 1 body mismatch, got %d", stats.BodyMismatches)
	}
	if stats.StatusMismatches != 1 {
		t.Errorf("expected 1 status mismatch, got %d", stats.StatusMismatches)
	}
	if stats.Errors != 1 {
		t.Errorf("expected 1 error, got %d", stats.Errors)
	}
}

func TestMetrics_Recent(t *testing.T) {
	m := shadow.NewMetrics(5)

	for i := 0; i < 10; i++ {
		m.Record(shadow.CompareResult{Endpoint: "/test"})
	}

	recent := m.Recent(3)
	if len(recent) != 3 {
		t.Errorf("expected 3 recent, got %d", len(recent))
	}

	all := m.Recent(100)
	if len(all) != 5 {
		t.Errorf("expected max 5 in buffer, got %d", len(all))
	}
}

func TestMetrics_Reset(t *testing.T) {
	m := shadow.NewMetrics(100)
	m.Record(shadow.CompareResult{StatusMatch: true, BodyMatch: true})
	m.Reset()

	stats := m.Stats()
	if stats.Total != 0 {
		t.Errorf("expected 0 after reset, got %d", stats.Total)
	}
}

func TestMetrics_MatchRate(t *testing.T) {
	m := shadow.NewMetrics(100)
	m.Record(shadow.CompareResult{StatusMatch: true, BodyMatch: true})
	m.Record(shadow.CompareResult{StatusMatch: true, BodyMatch: true})
	m.Record(shadow.CompareResult{StatusMatch: false, BodyMatch: false})

	stats := m.Stats()
	expected := 2.0 / 3.0
	if stats.MatchRate < expected-0.01 || stats.MatchRate > expected+0.01 {
		t.Errorf("expected match rate ~%.2f, got %.2f", expected, stats.MatchRate)
	}
}
