package repos

import (
	"encoding/json"
	"testing"

	indexscheduleapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexschedule"
)

func TestCurrentToolkitScheduleCandidatesAreDeterministicAndPreserveInvalidRows(t *testing.T) {
	indexesMeta := []byte(`{
	    "wiki": {
	      "schedules": {
	        "12": {
	          "cron": "0 4 * * *",
	          "enabled": true,
	          "credentials": {"private": true, "elitea_title": "personal"},
	          "created_by": 12,
	          "timezone": "Europe/Kyiv",
	          "last_run": "2026-07-27T01:00:00+00:00"
	        }
	      }
	    },
	    "docs": {
	      "schedules": {
	        "invalid": {"enabled": true},
	        "-1": {
	          "cron": "0 3 * * *",
	          "enabled": true,
	          "credentials": null,
	          "created_by": 11,
	          "timezone": "UTC",
	          "last_run": "2026-07-27T03:00:00+00:00"
	        }
	      }
	    }
	}`)
	first, err := currentToolkitScheduleCandidates(7, 9, "github", indexesMeta)
	if err != nil {
		t.Fatal(err)
	}
	second, err := currentToolkitScheduleCandidates(7, 9, "github", indexesMeta)
	if err != nil {
		t.Fatal(err)
	}
	firstJSON, _ := json.Marshal(first)
	secondJSON, _ := json.Marshal(second)
	if string(firstJSON) != string(secondJSON) {
		t.Fatalf("candidate order drifted:\n%s\n%s", firstJSON, secondJSON)
	}
	if len(first) != 3 ||
		first[0].IndexMetaID != "docs" || first[0].ScheduleUserID != -1 ||
		first[1].IndexMetaID != "docs" || first[1].ScheduleUserID != 0 ||
		first[2].IndexMetaID != "wiki" || first[2].ScheduleUserID != 12 {
		t.Fatalf("unexpected candidates: %+v", first)
	}
	if first[2].Schedule.Credentials == nil ||
		first[2].Schedule.Credentials.Private == nil ||
		!*first[2].Schedule.Credentials.Private {
		t.Fatalf("nested private schedule credentials were not preserved: %+v", first[2])
	}
}

func TestSameCurrentScheduleComparesNullableCredentialsByValue(t *testing.T) {
	private := true
	left := indexscheduleapp.Schedule{
		Cron: "0 3 * * *", Enabled: true, CreatedBy: 11, Timezone: "UTC",
		LastRun: "2026-07-27T03:00:00+00:00",
		Credentials: &indexscheduleapp.Credentials{
			Private: &private, EliteaTitle: "github",
		},
	}
	otherPrivate := true
	right := left
	right.Credentials = &indexscheduleapp.Credentials{
		Private: &otherPrivate, EliteaTitle: "github",
	}
	if !sameCurrentSchedule(left, right) {
		t.Fatal("equal credential values were treated as different pointers")
	}
	otherPrivate = false
	if sameCurrentSchedule(left, right) {
		t.Fatal("different private values were treated as equal")
	}
	right.Credentials.Private = nil
	if sameCurrentSchedule(left, right) {
		t.Fatal("null and concrete private values were treated as equal")
	}
}
