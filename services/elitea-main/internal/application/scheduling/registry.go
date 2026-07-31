package scheduling

import (
	"fmt"
	"sort"
	"time"
)

// Registry is an immutable closed set of typed jobs.
type Registry struct {
	byID       map[string]Job
	registered []RegisteredJob
}

// NewRegistry validates and freezes jobs. The lease duration is required so a
// handler timeout can never knowingly outlive its ownership lease.
func NewRegistry(leaseDuration time.Duration, jobs ...Job) (*Registry, error) {
	if leaseDuration <= 0 {
		return nil, fmt.Errorf("%w: lease duration must be positive", ErrInvalidConfiguration)
	}
	if len(jobs) == 0 || len(jobs) > MaxRegisteredJobs {
		return nil, fmt.Errorf("%w: registry must contain 1..%d jobs", ErrInvalidConfiguration, MaxRegisteredJobs)
	}
	byID := make(map[string]Job, len(jobs))
	for _, job := range jobs {
		if job.Timeout == 0 {
			job.Timeout = defaultHandlerTimeout
		}
		if err := job.validate(leaseDuration); err != nil {
			return nil, err
		}
		if _, exists := byID[job.ID]; exists {
			return nil, fmt.Errorf("%w: %q", ErrDuplicateJob, job.ID)
		}
		byID[job.ID] = job
	}
	registered := make([]RegisteredJob, 0, len(byID))
	for _, job := range byID {
		registered = append(registered, RegisteredJob{ID: job.ID, Revision: job.Revision})
	}
	sort.Slice(registered, func(i, j int) bool {
		return registered[i].ID < registered[j].ID
	})
	return &Registry{byID: byID, registered: registered}, nil
}

func (r *Registry) job(id, revision string) (Job, bool) {
	if r == nil {
		return Job{}, false
	}
	job, ok := r.byID[id]
	return job, ok && job.Revision == revision
}

func (r *Registry) jobs() []Job {
	if r == nil {
		return nil
	}
	jobs := make([]Job, 0, len(r.registered))
	for _, registered := range r.registered {
		jobs = append(jobs, r.byID[registered.ID])
	}
	return jobs
}

func (r *Registry) registeredJobs() []RegisteredJob {
	if r == nil {
		return nil
	}
	return append([]RegisteredJob(nil), r.registered...)
}
