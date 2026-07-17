package runtimecomposition

import (
	"errors"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DatabasePoolLimits is the fixed phase-one capacity profile. The five pools
// are intentionally separate so public SSE replay or content load cannot
// consume connections needed for admission, lease/control, or output
// settlement progress.
type DatabasePoolLimits struct {
	AdmissionPublisher int32
	Control            int32
	Output             int32
	Replay             int32
	Content            int32
}

func PhaseOneDatabasePoolLimits() DatabasePoolLimits {
	return DatabasePoolLimits{
		AdmissionPublisher: 10,
		Control:            8,
		Output:             8,
		Replay:             4,
		Content:            4,
	}
}

func (l DatabasePoolLimits) Validate() error {
	for _, limit := range []int32{l.AdmissionPublisher, l.Control, l.Output, l.Replay, l.Content} {
		if limit <= 0 || limit > 64 {
			return errors.New("runtime database pool capacity is invalid")
		}
	}
	return nil
}

func validateDependencies(dependencies Dependencies) error {
	if dependencies.Logger == nil {
		return errors.New("runtime logger is required")
	}
	pools := []*pgxpool.Pool{
		dependencies.AdmissionPool,
		dependencies.ControlPool,
		dependencies.OutputPool,
		dependencies.ReplayPool,
		dependencies.ContentPool,
	}
	for _, pool := range pools {
		if pool == nil {
			return errors.New("five isolated runtime database pools are required")
		}
	}
	for i, pool := range pools {
		for j := i + 1; j < len(pools); j++ {
			if pool == pools[j] {
				return errors.New("runtime database pools must not share capacity")
			}
		}
	}
	return nil
}
