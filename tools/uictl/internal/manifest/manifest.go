// Package manifest loads and validates the parity manifest
// (apps/elitea-web/parity/) against the schema rules of
// spec-ui-reimplementation §8.3.
//
// On disk the manifest is SHARDED so no tracked file trips the repo's
// 1 MiB no-binaries gate and CI diffs stay per-domain:
//
//	parity/manifest.json            root index: version, generatedFrom, shard list
//	parity/manifest/<domain>.json   one shard per §8.6 domain, carrying the items
//
// Load merges every shard into a single logical Manifest; duplicate-id
// detection and all §8.3 item rules run globally over the merged item set.
// A monolithic manifest (top-level "items") is still accepted so fixtures
// and downstream tools can validate single files.
package manifest

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type Manifest struct {
	Schema        string        `json:"$schema"`
	Version       int           `json:"version"`
	GeneratedFrom GeneratedFrom `json:"generatedFrom"`
	// Shards is set when the manifest is the sharded layout's root index.
	Shards []ShardRef `json:"shards,omitempty"`
	// Items is the merged item set (monolithic file, or all shards merged).
	Items []Item `json:"items,omitempty"`
}

type ShardRef struct {
	Path   string `json:"path"`
	Domain string `json:"domain"`
	Items  int    `json:"items"`
}

type shardFile struct {
	Schema string `json:"$schema"`
	Domain string `json:"domain"`
	Items  []Item `json:"items"`
}

type GeneratedFrom struct {
	Repo   string `json:"repo"`
	Commit string `json:"commit"`
	Date   string `json:"date"`
}

type Item struct {
	ID         string   `json:"id"`
	Domain     string   `json:"domain"`
	Kind       string   `json:"kind"`
	Priority   string   `json:"priority"`
	Title      string   `json:"title"`
	Source     []string `json:"source"`
	Acceptance []string `json:"acceptance"`
	Verify     Verify   `json:"verify"`
	Unit       string   `json:"unit"`
	Status     string   `json:"status"`
	Coverage   Coverage `json:"coverage"`
	Waiver     *Waiver  `json:"waiver"`
}

type Verify struct {
	Type    string `json:"type"`
	Command string `json:"command"`
	TestID  string `json:"testId"`
}

type Coverage struct {
	File string `json:"file"`
	Min  int    `json:"min"`
}

type Waiver struct {
	Reason            string `json:"reason"`
	DecidedBy         string `json:"decidedBy"`
	Date              string `json:"date"`
	ReplacesBehaviour string `json:"replacesBehaviour"`
}

// Load reads the root manifest (sharded index or monolithic) and returns the
// merged logical manifest. Shard bookkeeping errors (missing shard file,
// item-count mismatch, domain mismatch) fail the load — they mean the index
// and the shards disagree, which validation of the merged set cannot see.
func Load(path string) (*Manifest, error) {
	m, err := decodeFile(path)
	if err != nil {
		return nil, err
	}
	if len(m.Shards) == 0 {
		return m, nil
	}
	if len(m.Items) > 0 {
		return nil, fmt.Errorf("%s: a manifest must have either items or shards, not both", path)
	}
	dir := filepath.Dir(path)
	for _, ref := range m.Shards {
		sh, err := decodeShard(filepath.Join(dir, filepath.FromSlash(ref.Path)))
		if err != nil {
			return nil, fmt.Errorf("shard %s: %w", ref.Path, err)
		}
		if sh.Domain != ref.Domain {
			return nil, fmt.Errorf("shard %s: index says domain %q, shard says %q", ref.Path, ref.Domain, sh.Domain)
		}
		if len(sh.Items) != ref.Items {
			return nil, fmt.Errorf("shard %s: index says %d items, shard has %d", ref.Path, ref.Items, len(sh.Items))
		}
		for _, it := range sh.Items {
			if it.Domain != sh.Domain {
				return nil, fmt.Errorf("shard %s: item %s has domain %q, expected %q", ref.Path, it.ID, it.Domain, sh.Domain)
			}
		}
		m.Items = append(m.Items, sh.Items...)
	}
	return m, nil
}

func decodeFile(path string) (*Manifest, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open manifest: %w", err)
	}
	// The handle is read-only, so Close reports nothing the caller can act on.
	// The value is discarded on purpose, in the form the rest of the tree uses
	// (#427 — this module was never linted, so errcheck never saw this line).
	defer func() { _ = f.Close() }()
	dec := json.NewDecoder(f)
	dec.DisallowUnknownFields()
	var m Manifest
	if err := dec.Decode(&m); err != nil {
		return nil, fmt.Errorf("decode manifest %s: %w", path, err)
	}
	return &m, nil
}

func decodeShard(path string) (*shardFile, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open: %w", err)
	}
	// Read-only handle; see decodeFile above.
	defer func() { _ = f.Close() }()
	dec := json.NewDecoder(f)
	dec.DisallowUnknownFields()
	var s shardFile
	if err := dec.Decode(&s); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}
	return &s, nil
}

// UnverifiedMust returns the ids of every priority:must item whose status is
// not "verified" — the CI release gate (`--require-must`). A non-empty
// domain narrows it to that domain: a `cutover/<domain>` branch is audited
// on the domain it cuts over, not on the whole backlog.
func UnverifiedMust(m *Manifest, domain string) []string {
	var out []string
	for _, it := range m.Items {
		if domain != "" && it.Domain != domain {
			continue
		}
		if it.Priority == "must" && it.Status != "verified" {
			out = append(out, it.ID)
		}
	}
	return out
}

// HasDomain reports whether any item carries the domain — what makes a
// `--domain` filter that matches nothing a refusal rather than a green audit.
func HasDomain(m *Manifest, domain string) bool {
	for _, it := range m.Items {
		if it.Domain == domain {
			return true
		}
	}
	return false
}
