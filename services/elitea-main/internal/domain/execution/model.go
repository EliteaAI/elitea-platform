package execution

import (
	"errors"
	"fmt"
	"time"

	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
)

const (
	ConfigurationValidationCapability = "configuration.validate.v1"
	SettingsJSONMediaType             = "application/json"
	InputBundleManifestMediaType      = "application/x-protobuf"
)

var (
	ErrInvalidInputBundle = errors.New("invalid immutable input bundle")
	ErrInvalidJob         = errors.New("invalid execution job")
	ErrInvalidOutbox      = errors.New("invalid command outbox record")
)

type InputEntry struct {
	ID                    string
	Version               string
	SemanticRole          string
	ContentID             string
	MediaType             string
	Classification        string
	RequiredGrantAudience string
	ContentDigest         runtimedomain.Digest
	ContentLength         int64
	Content               []byte
}

// InputBundle holds the exact immutable manifest and content admitted for one
// job. Redis dispatch receives only BundleID/Digest and EntryID, never these
// byte slices.
type InputBundle struct {
	ID        string
	Version   string
	MediaType string
	Digest    runtimedomain.Digest
	Manifest  []byte
	Entry     InputEntry
}

func (b InputBundle) Validate() error {
	if b.ID == "" || b.Version == "" || b.MediaType != InputBundleManifestMediaType || b.Digest.IsZero() || len(b.Manifest) == 0 {
		return ErrInvalidInputBundle
	}
	if runtimedomain.SHA256(b.Manifest) != b.Digest {
		return fmt.Errorf("%w: manifest digest mismatch", ErrInvalidInputBundle)
	}
	if b.Entry.ID == "" || b.Entry.Version == "" || b.Entry.SemanticRole == "" || b.Entry.ContentID == "" || b.Entry.MediaType != SettingsJSONMediaType || b.Entry.Classification == "" || b.Entry.RequiredGrantAudience == "" || b.Entry.ContentDigest.IsZero() || b.Entry.ContentLength < 0 {
		return ErrInvalidInputBundle
	}
	if int64(len(b.Entry.Content)) != b.Entry.ContentLength || runtimedomain.SHA256(b.Entry.Content) != b.Entry.ContentDigest {
		return fmt.Errorf("%w: entry content mismatch", ErrInvalidInputBundle)
	}
	return nil
}

func (b InputBundle) Clone() InputBundle {
	b.Manifest = append([]byte(nil), b.Manifest...)
	b.Entry.Content = append([]byte(nil), b.Entry.Content...)
	return b
}

type JobState string

const (
	JobPending     JobState = "PENDING"
	JobDispatched  JobState = "DISPATCHED"
	JobClaimed     JobState = "CLAIMED"
	JobRunning     JobState = "RUNNING"
	JobSettling    JobState = "SETTLING"
	JobSucceeded   JobState = "SUCCEEDED"
	JobFailed      JobState = "FAILED"
	JobCancelled   JobState = "CANCELLED"
	JobQuarantined JobState = "QUARANTINED"
)

func (s JobState) Valid() bool {
	switch s {
	case JobPending, JobDispatched, JobClaimed, JobRunning, JobSettling, JobSucceeded, JobFailed, JobCancelled, JobQuarantined:
		return true
	default:
		return false
	}
}

type Job struct {
	ID                  string
	CommandID           string
	TenantID            string
	ResourceProjectID   string
	ProjectionProjectID string
	ActorID             string
	CapabilityID        string
	Generation          uint64
	State               JobState
	CreatedAt           time.Time
}

func (j Job) Validate() error {
	if j.ID == "" || j.CommandID == "" || j.TenantID == "" || j.ResourceProjectID == "" || j.ProjectionProjectID == "" || j.ActorID == "" {
		return ErrInvalidJob
	}
	if j.CapabilityID != ConfigurationValidationCapability || j.Generation == 0 || !j.State.Valid() || j.State != JobPending || j.CreatedAt.IsZero() {
		return ErrInvalidJob
	}
	return nil
}

type OutboxRecord struct {
	ID          string
	CommandID   string
	ExecutionID string
	Generation  uint64
	CreatedAt   time.Time
}

func (o OutboxRecord) Validate() error {
	if o.ID == "" || o.CommandID == "" || o.ExecutionID == "" || o.Generation == 0 || o.CreatedAt.IsZero() {
		return ErrInvalidOutbox
	}
	return nil
}

// Admission is persisted atomically: input bytes, job and outbox are either
// all committed or all absent.
type Admission struct {
	IdempotencyScope string
	IdempotencyKey   string
	RequestDigest    runtimedomain.Digest
	InputBundle      InputBundle
	Job              Job
	Outbox           OutboxRecord
}

func (a Admission) Validate() error {
	if a.IdempotencyScope == "" || a.IdempotencyKey == "" || a.RequestDigest.IsZero() {
		return errors.New("invalid idempotency binding")
	}
	if err := a.InputBundle.Validate(); err != nil {
		return err
	}
	if err := a.Job.Validate(); err != nil {
		return err
	}
	if err := a.Outbox.Validate(); err != nil {
		return err
	}
	if a.Job.ID != a.Outbox.ExecutionID || a.Job.CommandID != a.Outbox.CommandID || a.Job.Generation != a.Outbox.Generation {
		return errors.New("job and outbox identity mismatch")
	}
	return nil
}
