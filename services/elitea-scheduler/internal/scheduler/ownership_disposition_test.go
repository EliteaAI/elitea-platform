package scheduler

import (
	"os"
	"strings"
	"testing"
)

func TestRetirementNoteRejectsDualScheduleOwnership(t *testing.T) {
	raw, err := os.ReadFile("../../RETIREMENT.md")
	if err != nil {
		t.Fatal(err)
	}
	note := string(raw)
	required := []string{
		"not the owner of product schedule occurrences",
		"create two clocks and is forbidden",
		"index.schedule.scan.v1",
		"pipeline and other current `centry.schedule` rows remain owned",
		"must not be enabled as a fallback",
	}
	for _, fragment := range required {
		if !strings.Contains(note, fragment) {
			t.Fatalf("scheduler ownership disposition missing %q", fragment)
		}
	}
}
