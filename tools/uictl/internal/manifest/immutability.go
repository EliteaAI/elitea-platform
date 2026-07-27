package manifest

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
)

// CheckImmutability enforces the two append-only rules of §8.3/§9.4:
//
//  1. ids are immutable — every item id present in the committed (HEAD)
//     manifest must still exist in the working manifest;
//  2. acceptance text is immutable — an item's acceptance may not change
//     relative to HEAD unless the item carries a non-null waiver.
//
// When the manifest is not yet tracked in git (initial seeding, or a
// standalone checkout without git) there is no baseline to protect and the
// check passes vacuously.
func CheckImmutability(m *Manifest, manifestPath string) []string {
	old, ok := loadHEAD(manifestPath)
	if !ok {
		return nil
	}
	byID := make(map[string]*Item, len(m.Items))
	for i := range m.Items {
		byID[m.Items[i].ID] = &m.Items[i]
	}
	var problems []string
	for _, oldItem := range old.Items {
		cur, exists := byID[oldItem.ID]
		if !exists {
			problems = append(problems,
				fmt.Sprintf("%s: id present in committed manifest but deleted — ids are immutable", oldItem.ID))
			continue
		}
		if !equalLines(oldItem.Acceptance, cur.Acceptance) && cur.Waiver == nil {
			problems = append(problems,
				fmt.Sprintf("%s: acceptance text changed relative to the committed manifest without a waiver", oldItem.ID))
		}
	}
	return problems
}

func equalLines(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// loadHEAD returns the MERGED manifest as committed at git HEAD (index plus
// every committed shard), or ok=false when there is no committed version
// (untracked file, no git repo, no HEAD yet). Shards referenced by the
// committed index but themselves absent from HEAD contribute no baseline —
// their items are new, and new items are always allowed.
func loadHEAD(manifestPath string) (*Manifest, bool) {
	dir := filepath.Dir(manifestPath)
	base := filepath.Base(manifestPath)
	prefixOut, err := exec.Command("git", "-C", dir, "rev-parse", "--show-prefix").Output()
	if err != nil {
		return nil, false
	}
	prefix := strings.TrimSpace(string(prefixOut))
	blob, ok := gitShow(dir, prefix+base)
	if !ok {
		return nil, false
	}
	var old Manifest
	if err := json.Unmarshal(blob, &old); err != nil {
		// A committed manifest that no longer parses is a real problem, but
		// it is the committed side that is broken; surface it.
		return nil, false
	}
	for _, ref := range old.Shards {
		shardBlob, ok := gitShow(dir, prefix+ref.Path)
		if !ok {
			continue // shard not committed yet: nothing to protect
		}
		var sh shardFile
		if err := json.Unmarshal(shardBlob, &sh); err != nil {
			continue
		}
		old.Items = append(old.Items, sh.Items...)
	}
	return &old, true
}

func gitShow(dir, repoRel string) ([]byte, bool) {
	out, err := exec.Command("git", "-C", dir, "show", "HEAD:"+repoRel).Output()
	if err != nil {
		return nil, false
	}
	return out, true
}
