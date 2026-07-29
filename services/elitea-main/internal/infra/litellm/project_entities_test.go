package litellm

import (
	"errors"
	"reflect"
	"testing"
)

func TestProjectEntityProjectionPreservesCurrentAliasesAndMembership(t *testing.T) {
	projection, err := ProjectEntityProjection(7, 1, []ModelRecord{
		{ModelName: "7_project-model"},
		{ModelName: "١_project-model"},
		{ModelName: "gpt-4o"},
		{ModelName: ""},
		{ModelName: "external/model"},
		{ModelName: "gpt-4o"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if projection.TeamAlias != "project_7" || projection.KeyAlias != "project_key_7" {
		t.Fatalf("aliases = team %q key %q", projection.TeamAlias, projection.KeyAlias)
	}
	wantTeamModels := []string{"7_*", "1_*", "gpt-4o", "external/model", "gpt-4o"}
	if !reflect.DeepEqual(projection.TeamModels, wantTeamModels) {
		t.Fatalf("team models = %#v, want %#v", projection.TeamModels, wantTeamModels)
	}
	if !reflect.DeepEqual(projection.KeyModels, []string{"all-team-models"}) {
		t.Fatalf("key models = %#v", projection.KeyModels)
	}
}

func TestProjectEntityProjectionOmitsDuplicatePublicWildcard(t *testing.T) {
	projection, err := ProjectEntityProjection(7, 7, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(projection.TeamModels, []string{"7_*"}) {
		t.Fatalf("team models = %#v", projection.TeamModels)
	}
}

func TestProjectEntityProjectionRejectsInvalidOrUnboundedInputs(t *testing.T) {
	tests := []struct {
		name      string
		projectID int64
		publicID  int64
		models    []ModelRecord
	}{
		{name: "project", publicID: 1},
		{name: "public", projectID: 1},
		{name: "invalid model", projectID: 1, publicID: 1, models: []ModelRecord{{ModelName: "bad\nmodel"}}},
		{name: "too many", projectID: 1, publicID: 1, models: make([]ModelRecord, maxAdminModelMembershipItems+1)},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := ProjectEntityProjection(test.projectID, test.publicID, test.models)
			if !errors.Is(err, ErrInvalidProjection) {
				t.Fatalf("error = %v", err)
			}
		})
	}
}
