package configurations

import (
	"context"
	"errors"
	"fmt"
	"sort"
)

const (
	// MaxCurrentConfigurationTypes preserves ample room for the current 49-type
	// catalog and deployment-specific types while bounding one lightweight UI
	// response. Repositories must apply the supplied MaxRows before materializing
	// their result.
	MaxCurrentConfigurationTypes      = 256
	MaxCurrentConfigurationTypeLength = 128
)

var ErrInvalidCurrentConfigurationTypesRequest = errors.New("invalid current configuration types request")

// CurrentConfigurationTypesFilter is one bounded tenant query. An empty
// Section intentionally means no section predicate; the HTTP boundary owns the
// current distinction between an absent section and an explicitly empty one.
type CurrentConfigurationTypesFilter struct {
	ProjectID int32
	Section   string
	MaxRows   int
}

// CurrentConfigurationTypesRepository is the minimum persistence surface
// required by the current type-list endpoint. Implementations must route the
// trusted ProjectID to its tenant schema and return at most MaxRows distinct
// type values.
type CurrentConfigurationTypesRepository interface {
	ListDistinctTypes(context.Context, CurrentConfigurationTypesFilter) ([]string, error)
}

type CurrentConfigurationTypesQuery struct {
	ProjectID int32
	Section   string
}

type CurrentConfigurationTypesResult struct {
	Rows  []string
	Total int
}

type CurrentConfigurationTypesService struct {
	repository CurrentConfigurationTypesRepository
}

func NewCurrentConfigurationTypesService(
	repository CurrentConfigurationTypesRepository,
) (*CurrentConfigurationTypesService, error) {
	if repository == nil {
		return nil, errors.New("current configuration types repository is required")
	}
	return &CurrentConfigurationTypesService{repository: repository}, nil
}

func (service *CurrentConfigurationTypesService) List(
	ctx context.Context,
	query CurrentConfigurationTypesQuery,
) (CurrentConfigurationTypesResult, error) {
	if ctx == nil || query.ProjectID <= 0 || len(query.Section) > MaxCurrentConfigurationTypeLength {
		return CurrentConfigurationTypesResult{}, ErrInvalidCurrentConfigurationTypesRequest
	}
	if err := ctx.Err(); err != nil {
		return CurrentConfigurationTypesResult{}, err
	}

	rows, err := service.repository.ListDistinctTypes(ctx, CurrentConfigurationTypesFilter{
		ProjectID: query.ProjectID,
		Section:   query.Section,
		MaxRows:   MaxCurrentConfigurationTypes + 1,
	})
	if err != nil {
		return CurrentConfigurationTypesResult{}, fmt.Errorf("list distinct current configuration types: %w", err)
	}
	if len(rows) > MaxCurrentConfigurationTypes+1 {
		return CurrentConfigurationTypesResult{}, errors.New("current configuration types repository exceeded its row bound")
	}

	distinct := make(map[string]struct{}, len(rows))
	for _, configurationType := range rows {
		if len(configurationType) > MaxCurrentConfigurationTypeLength {
			return CurrentConfigurationTypesResult{}, errors.New("current configuration type exceeds its value bound")
		}
		distinct[configurationType] = struct{}{}
		if len(distinct) > MaxCurrentConfigurationTypes {
			return CurrentConfigurationTypesResult{}, errors.New("current configuration types exceed the response bound")
		}
	}

	result := make([]string, 0, len(distinct))
	for configurationType := range distinct {
		result = append(result, configurationType)
	}
	sort.Strings(result)
	return CurrentConfigurationTypesResult{Rows: result, Total: len(result)}, nil
}
