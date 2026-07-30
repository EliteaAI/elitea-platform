package configurations

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
)

// CurrentConfigurationBaseReader is the persisted-row read contract wrapped
// by response-only parity enrichments. Mutation orchestration remains outside
// this interface.
type CurrentConfigurationBaseReader interface {
	List(context.Context, CurrentConfigurationListRequest) (CurrentConfigurationListResult, error)
	Get(context.Context, int32, int32) (CurrentConfiguration, error)
}

// CurrentConfigurationReadService composes the current tenant-row read with
// nested configuration options. List endpoints preserve the current API's
// best-effort behavior by returning an empty options object when enrichment
// fails; detail reads remain strict and surface the failure.
type CurrentConfigurationReadService struct {
	base            CurrentConfigurationBaseReader
	options         *CurrentConfigurationOptionsEnricher
	publicProjectID int32
}

func NewCurrentConfigurationReadService(
	base CurrentConfigurationBaseReader,
	options *CurrentConfigurationOptionsEnricher,
	publicProjectID int32,
) (*CurrentConfigurationReadService, error) {
	if base == nil || options == nil || publicProjectID <= 0 {
		return nil, errors.New("current configuration read dependencies are required")
	}
	return &CurrentConfigurationReadService{
		base:            base,
		options:         options,
		publicProjectID: publicProjectID,
	}, nil
}

func (s *CurrentConfigurationReadService) List(
	ctx context.Context,
	request CurrentConfigurationListRequest,
) (CurrentConfigurationListResult, error) {
	if s == nil || s.base == nil || s.options == nil ||
		request.PublicProjectID != s.publicProjectID {
		return CurrentConfigurationListResult{}, ErrInvalidCurrentConfigurationRequest
	}

	result, err := s.base.List(ctx, request)
	if err != nil {
		return CurrentConfigurationListResult{}, err
	}

	result.Items, err = s.enrichListPage(
		ctx,
		request.ProjectID,
		request.IncludeShared,
		result.Items,
	)
	if err != nil {
		return CurrentConfigurationListResult{}, err
	}
	if result.Shared == nil {
		return result, nil
	}

	result.Shared.Items, err = s.enrichListPage(
		ctx,
		s.publicProjectID,
		true,
		result.Shared.Items,
	)
	if err != nil {
		return CurrentConfigurationListResult{}, err
	}
	return result, nil
}

func (s *CurrentConfigurationReadService) Get(
	ctx context.Context,
	projectID, configurationID int32,
) (CurrentConfiguration, error) {
	if s == nil || s.base == nil || s.options == nil {
		return CurrentConfiguration{}, ErrInvalidCurrentConfigurationRequest
	}
	configuration, err := s.base.Get(ctx, projectID, configurationID)
	if err != nil {
		return CurrentConfiguration{}, err
	}

	enriched, err := s.options.Enrich(ctx, CurrentConfigurationOptionsRequest{
		ProjectID:       projectID,
		PublicProjectID: s.publicProjectID,
		IncludeShared:   true,
		Configurations:  []CurrentConfiguration{configuration},
	})
	if err != nil {
		return CurrentConfiguration{}, fmt.Errorf("enrich current configuration detail options: %w", err)
	}
	if len(enriched) != 1 {
		return CurrentConfiguration{}, errors.New("current configuration detail enrichment returned an invalid result")
	}
	return enriched[0], nil
}

func (s *CurrentConfigurationReadService) enrichListPage(
	ctx context.Context,
	projectID int32,
	includeShared bool,
	configurations []CurrentConfiguration,
) ([]CurrentConfiguration, error) {
	enriched, err := s.options.Enrich(ctx, CurrentConfigurationOptionsRequest{
		ProjectID:       projectID,
		PublicProjectID: s.publicProjectID,
		IncludeShared:   includeShared,
		Configurations:  configurations,
	})
	if err == nil {
		return enriched, nil
	}
	if contextErr := ctx.Err(); contextErr != nil {
		return nil, contextErr
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return nil, err
	}

	slog.WarnContext(
		ctx,
		"current configuration list options enrichment failed",
		"project_id", projectID,
		"error", err,
	)
	return currentConfigurationsWithEmptyOptions(configurations), nil
}

func currentConfigurationsWithEmptyOptions(
	configurations []CurrentConfiguration,
) []CurrentConfiguration {
	result := make([]CurrentConfiguration, len(configurations))
	copy(result, configurations)
	for index := range result {
		options := map[string]any{}
		result[index].Options = &options
	}
	return result
}

var _ CurrentConfigurationBaseReader = (*CurrentCRUDService)(nil)
