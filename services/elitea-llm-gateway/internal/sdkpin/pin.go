// Package sdkpin carries the gateway's declared relationship to elitea-sdk.
//
// The /llm surface has one first-class client. Its budget reader decides what a
// correct 402 body looks like, and its two base paths decide which routes must
// exist. The gateway used to declare no relationship to it, so an SDK bump
// could not fail a gateway gate — which is how the budget-scope defect shipped.
//
// The pinned revision itself belongs to
// services/elitea-worker-python/elitea-sdk.lock.json. This package holds the
// SEPARATE statement that the gateway's compatibility gates were run against
// that revision and passed. pin_test.go compares the two, so moving the SDK
// turns the gateway test job red with no gateway source change.
package sdkpin

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"regexp"
)

//go:embed sdk-pin.json
var pinJSON []byte

// hexRevision matches a full 40-character git object name. A short name would
// still resolve for a human but cannot be compared byte-for-byte with the lock
// file, and a comparison that silently never matches is the failure mode this
// whole package exists to prevent.
var hexRevision = regexp.MustCompile(`^[0-9a-f]{40}$`)

// VerifiedAgainst is the SDK revision the gateway compatibility gates last
// passed against, with the patch revisions that were applied on top of it.
type VerifiedAgainst struct {
	Revision       string   `json:"revision"`
	PatchRevisions []string `json:"patch_revisions"`
	VerifiedOn     string   `json:"verified_on"`
}

// Pin is the parsed sdk-pin.json.
type Pin struct {
	// LockFile is the repository-relative path of the file that OWNS the
	// revision. It is stored rather than hard-coded in Go so that a move of the
	// lock file is one edit, and so the test reports the path it actually read.
	LockFile        string          `json:"lock_file"`
	VerifiedAgainst VerifiedAgainst `json:"verified_against"`
}

// Load parses the embedded pin and rejects a shape the comparison cannot use.
//
// Every check below turns a value that would make the comparison VACUOUS into
// an error. An empty revision compares equal to nothing and unequal to
// everything depending on which side is empty; an empty patch list makes a
// set comparison trivially true. Neither may reach the caller.
func Load() (Pin, error) {
	var p Pin
	if err := json.Unmarshal(pinJSON, &p); err != nil {
		return Pin{}, fmt.Errorf("sdkpin: sdk-pin.json does not parse: %w", err)
	}
	if p.LockFile == "" {
		return Pin{}, fmt.Errorf("sdkpin: lock_file is empty, so the comparison has no other side to read")
	}
	if !hexRevision.MatchString(p.VerifiedAgainst.Revision) {
		return Pin{}, fmt.Errorf(
			"sdkpin: verified_against.revision %q is not a 40-character git object name",
			p.VerifiedAgainst.Revision)
	}
	if len(p.VerifiedAgainst.PatchRevisions) == 0 {
		return Pin{}, fmt.Errorf(
			"sdkpin: verified_against.patch_revisions is empty. The pinned SDK is a " +
				"revision PLUS cherry-picks; an empty list would compare equal to a lock " +
				"file that dropped them all")
	}
	seen := make(map[string]struct{}, len(p.VerifiedAgainst.PatchRevisions))
	for _, rev := range p.VerifiedAgainst.PatchRevisions {
		if !hexRevision.MatchString(rev) {
			return Pin{}, fmt.Errorf(
				"sdkpin: patch revision %q is not a 40-character git object name", rev)
		}
		if _, dup := seen[rev]; dup {
			return Pin{}, fmt.Errorf("sdkpin: patch revision %q is listed twice", rev)
		}
		seen[rev] = struct{}{}
	}
	return p, nil
}

// MustLoad is Load for callers that cannot report an error. It panics, which is
// correct here: the file is embedded at build time, so a failure is a broken
// build rather than a runtime condition.
func MustLoad() Pin {
	p, err := Load()
	if err != nil {
		panic(err)
	}
	return p
}
