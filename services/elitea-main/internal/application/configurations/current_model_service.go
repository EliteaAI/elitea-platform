package configurations

import (
	"context"
	"errors"
	"fmt"
)

var ErrInvalidCurrentModelCatalogRequest = errors.New("invalid current model catalog request")

// CurrentModelCatalogQuery is the authorized identity and selection input for
// one current model-list request. Project IDs are database identities, never
// schema names supplied directly to a repository.
type CurrentModelCatalogQuery struct {
	Section         CurrentModelSection
	ProjectID       int32
	PublicProjectID int32
	IncludeShared   bool
}

// CurrentModelCandidateRepository reads one bounded, tenant-scoped candidate
// list. sharedOnly is true only for the public-project fallback query.
type CurrentModelCandidateRepository interface {
	List(context.Context, int32, CurrentModelSection, bool) ([]CurrentModelCatalogItem, error)
}

// CurrentModelDefaultsLoader reads the current project/public vault sources.
// Secret precedence and encrypted-storage compatibility belong to its adapter.
type CurrentModelDefaultsLoader interface {
	Load(context.Context, int32, int32, CurrentModelSection) (CurrentModelCatalogDefaults, error)
}

// CurrentModelCatalogService orchestrates the current configuration rows and
// vault defaults, then delegates response parity to BuildCurrentModelCatalog.
type CurrentModelCatalogService struct {
	candidates CurrentModelCandidateRepository
	defaults   CurrentModelDefaultsLoader
}

func NewCurrentModelCatalogService(
	candidates CurrentModelCandidateRepository,
	defaults CurrentModelDefaultsLoader,
) (*CurrentModelCatalogService, error) {
	if candidates == nil || defaults == nil {
		return nil, errors.New("current model catalog dependencies are required")
	}
	return &CurrentModelCatalogService{candidates: candidates, defaults: defaults}, nil
}

func (s *CurrentModelCatalogService) Get(
	ctx context.Context,
	query CurrentModelCatalogQuery,
) (CurrentModelCatalogResponse, error) {
	if err := validateCurrentModelCatalogQuery(ctx, query); err != nil {
		return CurrentModelCatalogResponse{}, err
	}

	projectItems, err := s.candidates.List(ctx, query.ProjectID, query.Section, false)
	if err != nil {
		return CurrentModelCatalogResponse{}, currentModelCatalogDependencyError(ctx, "list project model configurations", err)
	}
	if err := ctx.Err(); err != nil {
		return CurrentModelCatalogResponse{}, err
	}

	var publicSharedItems []CurrentModelCatalogItem
	if query.IncludeShared && query.ProjectID != query.PublicProjectID {
		publicSharedItems, err = s.candidates.List(ctx, query.PublicProjectID, query.Section, true)
		if err != nil {
			return CurrentModelCatalogResponse{}, currentModelCatalogDependencyError(ctx, "list public model configurations", err)
		}
		if err := ctx.Err(); err != nil {
			return CurrentModelCatalogResponse{}, err
		}
	}

	defaults, err := s.defaults.Load(ctx, query.ProjectID, query.PublicProjectID, query.Section)
	if err != nil {
		return CurrentModelCatalogResponse{}, currentModelCatalogDependencyError(ctx, "load current model defaults", err)
	}
	if err := ctx.Err(); err != nil {
		return CurrentModelCatalogResponse{}, err
	}

	return BuildCurrentModelCatalog(CurrentModelCatalogRequest{
		Section:           query.Section,
		ProjectID:         query.ProjectID,
		PublicProjectID:   query.PublicProjectID,
		IncludeShared:     query.IncludeShared,
		ProjectItems:      projectItems,
		PublicSharedItems: publicSharedItems,
		Defaults:          defaults,
	}), nil
}

func validateCurrentModelCatalogQuery(ctx context.Context, query CurrentModelCatalogQuery) error {
	if ctx == nil || query.ProjectID <= 0 || query.PublicProjectID <= 0 || !IsSupportedCurrentModelSection(query.Section) {
		return ErrInvalidCurrentModelCatalogRequest
	}
	return ctx.Err()
}

func currentModelCatalogDependencyError(ctx context.Context, operation string, err error) error {
	if contextErr := ctx.Err(); contextErr != nil {
		return contextErr
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	return fmt.Errorf("%s: %w", operation, err)
}
