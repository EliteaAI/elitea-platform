package manifest

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeShardLayout writes a root index + shards to dir and returns the index path.
func writeShardLayout(t *testing.T, dir string, shards map[string][]Item, counts map[string]int) string {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(dir, "manifest"), 0o755); err != nil {
		t.Fatal(err)
	}
	var refs []ShardRef
	for domain, items := range shards {
		body := map[string]any{"$schema": "../manifest.schema.json", "domain": domain, "items": items}
		data, err := json.MarshalIndent(body, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "manifest", domain+".json"), data, 0o644); err != nil {
			t.Fatal(err)
		}
		n := len(items)
		if c, ok := counts[domain]; ok {
			n = c // deliberately wrong count for the mismatch test
		}
		refs = append(refs, ShardRef{Path: "manifest/" + domain + ".json", Domain: domain, Items: n})
	}
	index := map[string]any{
		"$schema": "./manifest.schema.json",
		"version": 1,
		"generatedFrom": map[string]string{
			"repo": "apps/elitea-ui", "commit": "a55f36cfb5ecb3834bb00bbc8d9cd9a1393168af", "date": "2026-07-26",
		},
		"shards": refs,
	}
	data, err := json.MarshalIndent(index, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "manifest.json")
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func chatItem(id string) Item {
	it := validItem()
	it.ID = id
	it.Domain = "chat"
	return it
}

func agentsItem(id string) Item {
	it := validItem()
	it.ID = id
	it.Domain = "agents"
	return it
}

func TestLoad_ShardedMergesAllShards(t *testing.T) {
	path := writeShardLayout(t, t.TempDir(), map[string][]Item{
		"chat":   {chatItem("TEST-001"), chatItem("TEST-002")},
		"agents": {agentsItem("TEST-003")},
	}, nil)
	m, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(m.Items) != 3 {
		t.Fatalf("merged items = %d, want 3", len(m.Items))
	}
	if len(m.Shards) != 2 {
		t.Fatalf("shard refs = %d, want 2", len(m.Shards))
	}
}

func TestLoad_ShardCountMismatchFails(t *testing.T) {
	path := writeShardLayout(t, t.TempDir(), map[string][]Item{
		"chat": {chatItem("TEST-001"), chatItem("TEST-002")},
	}, map[string]int{"chat": 5})
	if _, err := Load(path); err == nil || !strings.Contains(err.Error(), "index says 5 items") {
		t.Fatalf("expected count-mismatch error, got %v", err)
	}
}

func TestLoad_ShardDomainMismatchFails(t *testing.T) {
	// an agents item smuggled into the chat shard
	path := writeShardLayout(t, t.TempDir(), map[string][]Item{
		"chat": {chatItem("TEST-001"), agentsItem("TEST-002")},
	}, nil)
	if _, err := Load(path); err == nil || !strings.Contains(err.Error(), "has domain") {
		t.Fatalf("expected domain-mismatch error, got %v", err)
	}
}

func TestLoad_MissingShardFileFails(t *testing.T) {
	dir := t.TempDir()
	path := writeShardLayout(t, dir, map[string][]Item{
		"chat": {chatItem("TEST-001")},
	}, nil)
	if err := os.Remove(filepath.Join(dir, "manifest", "chat.json")); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path); err == nil {
		t.Fatal("expected error for missing shard file")
	}
}

// Duplicate ids must be caught GLOBALLY across shards, not per shard.
func TestValidate_DuplicateIDsAcrossShards(t *testing.T) {
	base := fixtureBaseline(t)
	path := writeShardLayout(t, t.TempDir(), map[string][]Item{
		"chat":   {chatItem("TEST-001")},
		"agents": {agentsItem("TEST-001")},
	}, nil)
	m, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	problems := Validate(m, base)
	joined := strings.Join(problems, "\n")
	if !strings.Contains(joined, "duplicate id") {
		t.Fatalf("expected global duplicate-id detection across shards, got %v", problems)
	}
}

func TestLoad_ItemsAndShardsMutuallyExclusive(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "manifest.json")
	bad := map[string]any{
		"$schema": "./manifest.schema.json",
		"version": 1,
		"generatedFrom": map[string]string{
			"repo": "apps/elitea-ui", "commit": "a55f36cfb5ecb3834bb00bbc8d9cd9a1393168af", "date": "2026-07-26",
		},
		"shards": []ShardRef{{Path: "manifest/chat.json", Domain: "chat", Items: 1}},
		"items":  []Item{validItem()},
	}
	data, _ := json.Marshal(bad)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(path); err == nil || !strings.Contains(err.Error(), "not both") {
		t.Fatalf("expected items/shards exclusivity error, got %v", err)
	}
}
