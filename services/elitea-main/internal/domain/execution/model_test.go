package execution

import "testing"

func TestJobStateIncludesDurableQuarantine(t *testing.T) {
	states := []JobState{
		JobPending,
		JobDispatched,
		JobClaimed,
		JobRunning,
		JobSettling,
		JobSucceeded,
		JobFailed,
		JobCancelled,
		JobQuarantined,
	}
	for _, state := range states {
		if !state.Valid() {
			t.Fatalf("durable job state %q is not valid", state)
		}
	}
	if JobState("UNKNOWN").Valid() {
		t.Fatal("unknown durable job state was accepted")
	}
}
