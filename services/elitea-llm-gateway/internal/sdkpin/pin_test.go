package sdkpin

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// repoRootRelative is the path from this package directory to the repository
// root. The lock file the gateway compares itself against lives outside this
// module, so it cannot be embedded; it is read from disk instead.
const repoRootRelative = "../../../.."

// lockFile is the shape this test reads out of
// services/elitea-worker-python/elitea-sdk.lock.json. Only the source block is
// needed; the rest of that file describes the worker image.
type lockFile struct {
	Source struct {
		Revision       string   `json:"revision"`
		PatchRevisions []string `json:"patch_revisions"`
	} `json:"source"`
}

// TestPinParses rejects a pin whose shape would make the comparison below
// vacuous. Load() carries the rules; this asserts they run.
func TestPinParses(t *testing.T) {
	pin, err := Load()
	if err != nil {
		t.Fatalf("sdk-pin.json is not usable: %v", err)
	}
	if pin.VerifiedAgainst.Revision == "" {
		t.Fatal("Load returned an empty revision without an error")
	}
}

// TestPinMatchesTheWorkerLockFile is the gate this package exists for.
//
// The gateway must stay compatible with elitea-sdk, and until this test existed
// an SDK bump could not fail any gateway gate: the gateway named the SDK
// nowhere. The lock file at services/elitea-worker-python/elitea-sdk.lock.json
// OWNS the revision; sdk-pin.json states which revision the gateway's
// compatibility gates (scripts/contract/test_sdk_budget_contract.py and
// scripts/sdk-conformance/run.sh) were last run against.
//
// Moving the SDK therefore turns this job red with no gateway source change.
// The fix is to run both gates against the new revision and, only if they pass,
// update sdk-pin.json.
//
// Prevents: an SDK whose budget reader, base paths or LangChain dialect moved,
// merged while every gateway test still passed.
func TestPinMatchesTheWorkerLockFile(t *testing.T) {
	pin, err := Load()
	if err != nil {
		t.Fatalf("sdk-pin.json is not usable: %v", err)
	}

	path := filepath.Join(repoRootRelative, filepath.FromSlash(pin.LockFile))
	raw, err := os.ReadFile(path) //nolint:gosec // a fixed repository path, not caller input
	if err != nil {
		// A missing lock file must FAIL, never skip. "The other side of the
		// comparison was not there" is the shape this repository keeps
		// mistaking for a pass.
		t.Fatalf("cannot read the lock file %s that sdk-pin.json names (%s): %v\n"+
			"Either the lock file moved — update lock_file in sdk-pin.json — or this "+
			"gate is comparing against nothing.", pin.LockFile, path, err)
	}

	var lock lockFile
	if err := json.Unmarshal(raw, &lock); err != nil {
		t.Fatalf("%s does not parse as JSON: %v", pin.LockFile, err)
	}
	if lock.Source.Revision == "" {
		t.Fatalf("%s carries no source.revision. An empty value would compare "+
			"unequal to every pin and equal to none, so this gate cannot run.", pin.LockFile)
	}
	if len(lock.Source.PatchRevisions) == 0 {
		t.Fatalf("%s carries no source.patch_revisions. The pinned SDK is a revision "+
			"PLUS cherry-picks, and an empty list here would let a dropped patch pass.",
			pin.LockFile)
	}

	if lock.Source.Revision != pin.VerifiedAgainst.Revision {
		t.Fatalf("the elitea-sdk pin moved and the gateway compatibility gates have not "+
			"been re-run.\n  %s names   %s\n  sdk-pin.json verified %s\n"+
			"Run scripts/contract/test_sdk_budget_contract.py and "+
			"services/elitea-llm-gateway/scripts/sdk-conformance/run.sh against the new "+
			"revision. Update sdk-pin.json ONLY after both pass — updating it first "+
			"turns a real incompatibility into a green build.",
			pin.LockFile, lock.Source.Revision, pin.VerifiedAgainst.Revision)
	}

	// The cherry-picks are part of the pinned tree, so a dropped or added patch
	// is an SDK move too. Compared as an ordered list because the workflow
	// applies them in order and a reorder can change the result.
	if len(lock.Source.PatchRevisions) != len(pin.VerifiedAgainst.PatchRevisions) {
		t.Fatalf("%s applies %d patch revision(s), sdk-pin.json was verified against %d",
			pin.LockFile, len(lock.Source.PatchRevisions), len(pin.VerifiedAgainst.PatchRevisions))
	}
	for i, want := range pin.VerifiedAgainst.PatchRevisions {
		if lock.Source.PatchRevisions[i] != want {
			t.Fatalf("patch revision %d differs: %s names %s, sdk-pin.json verified %s",
				i, pin.LockFile, lock.Source.PatchRevisions[i], want)
		}
	}
}
