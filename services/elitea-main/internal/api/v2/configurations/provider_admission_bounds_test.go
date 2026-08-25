package configurations

import (
	"math"
	"testing"
)

// The snapshot carries int32 ids because id, project_id and author_id are
// INTEGER columns. The project id reaches configurationAdmissionSnapshot from
// the request path through strconv.Atoi, which accepts every value an `int`
// holds, so a value above math.MaxInt32 truncates in the int32 conversion
// (CodeQL go/incorrect-integer-conversion). snapshot.ProjectID is the
// project_id the status write compares in its WHERE clause, so a truncated
// value points that write at another project.
func TestConfigurationAdmissionSnapshotRefusesAnIDNoRowCanHold(t *testing.T) {
	t.Parallel()

	for _, testCase := range []struct {
		name      string
		id        int
		projectID int
	}{
		{name: "a project id above the column", id: 7, projectID: math.MaxInt32 + 1},
		{name: "a project id below the column", id: 7, projectID: 0},
		{name: "a row id above the column", id: math.MaxInt32 + 1, projectID: 3},
		{name: "a row id below the column", id: 0, projectID: 3},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			snapshot, ok := configurationAdmissionSnapshot(
				testCase.id, "u", testCase.projectID, "t", "open_ai", "ai_credentials", nil, nil,
			)
			if ok {
				t.Fatalf("id %d project %d was admitted as id %d project %d",
					testCase.id, testCase.projectID, snapshot.ID, snapshot.ProjectID)
			}
		})
	}
}

// An id inside the column keeps its exact value, and the author is carried.
func TestConfigurationAdmissionSnapshotKeepsAnIDTheColumnHolds(t *testing.T) {
	t.Parallel()

	author := 11
	snapshot, ok := configurationAdmissionSnapshot(
		math.MaxInt32, "u", 3, "t", "open_ai", "ai_credentials", nil, &author,
	)
	if !ok {
		t.Fatal("an id the column holds was refused")
	}
	if snapshot.ID != math.MaxInt32 || snapshot.ProjectID != 3 {
		t.Errorf("snapshot = (id %d, project %d), want (id %d, project 3)",
			snapshot.ID, snapshot.ProjectID, int32(math.MaxInt32))
	}
	if snapshot.AuthorID == nil || *snapshot.AuthorID != 11 {
		t.Errorf("author = %v, want 11", snapshot.AuthorID)
	}
	if snapshot.Data == nil {
		t.Error("Data is nil; the admission decision reads it")
	}
}

// The author does not identify the row, so an author id the column cannot hold
// is left out rather than refused. Refusing would drop the status_ok decision
// for the whole row, and a row with no decision is invisible to the LLM
// gateway (#457).
func TestConfigurationAdmissionSnapshotDropsAnAuthorTheColumnCannotHold(t *testing.T) {
	t.Parallel()

	for _, author := range []int{math.MaxInt32 + 1, 0, -1} {
		snapshot, ok := configurationAdmissionSnapshot(
			7, "u", 3, "t", "open_ai", "ai_credentials", nil, &author,
		)
		if !ok {
			t.Fatalf("author %d dropped the whole admission decision", author)
		}
		if snapshot.AuthorID != nil {
			t.Errorf("author %d was carried as %d", author, *snapshot.AuthorID)
		}
	}
}
