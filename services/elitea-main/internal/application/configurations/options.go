package configurations

import (
	"context"
	"errors"
	"fmt"
	"sort"
)

const (
	MaxCurrentConfigurationOptionCandidates = 10_000
	currentConfigurationOptionQueryRows     = MaxCurrentConfigurationOptionCandidates + 1
)

var (
	ErrInvalidCurrentConfigurationOptionsRequest = errors.New("invalid current configuration options request")
	ErrCurrentConfigurationOptionsTooLarge       = errors.New("current configuration options exceed the safe row limit")
)

// CurrentConfigurationOption is the exact nested-options item returned by the
// current Configurations API. It deliberately excludes configuration data,
// metadata, status, and secrets.
type CurrentConfigurationOption struct {
	EliteaTitle string  `json:"elitea_title"`
	Label       *string `json:"label"`
	Type        string  `json:"type"`
	Section     string  `json:"section"`
	Shared      bool    `json:"shared"`
	ProjectID   int32   `json:"project_id"`
}

// CurrentConfigurationOptionCandidatesQuery describes one bounded visibility
// prefetch. Types and Sections are union filters: a row matching either set can
// be needed by a schema field. MaxRows is the overflow sentinel, not a promise
// that silently truncated options are acceptable.
type CurrentConfigurationOptionCandidatesQuery struct {
	ProjectID       int32
	PublicProjectID int32
	IncludeShared   bool
	Types           []string
	Sections        []string
	MaxRows         int
}

// CurrentConfigurationOptionCandidates reads the already-authorized project
// rows and, when requested, shared public-project rows in stable order. The
// implementation may use multiple tenant transactions, but the consumer calls
// it once per options scope rather than once per configuration.
type CurrentConfigurationOptionCandidates interface {
	ListCurrentConfigurationOptionCandidates(
		context.Context,
		CurrentConfigurationOptionCandidatesQuery,
	) ([]CurrentConfigurationOption, error)
}

type CurrentConfigurationOptionsRequest struct {
	ProjectID       int32
	PublicProjectID int32
	IncludeShared   bool
	Configurations  []CurrentConfiguration
}

// CurrentConfigurationOptionsEnricher applies the current schema annotations
// to a bounded configuration page. It is safe for concurrent use when its
// candidate source is safe, and returns a newly owned result slice and options.
type CurrentConfigurationOptionsEnricher struct {
	catalog    *CurrentAvailableCatalog
	candidates CurrentConfigurationOptionCandidates
}

func NewCurrentConfigurationOptionsEnricher(
	catalog *CurrentAvailableCatalog,
	candidates CurrentConfigurationOptionCandidates,
) (*CurrentConfigurationOptionsEnricher, error) {
	if catalog == nil || candidates == nil {
		return nil, errors.New("current configuration options dependencies are required")
	}
	return &CurrentConfigurationOptionsEnricher{catalog: catalog, candidates: candidates}, nil
}

func (e *CurrentConfigurationOptionsEnricher) Enrich(
	ctx context.Context,
	request CurrentConfigurationOptionsRequest,
) ([]CurrentConfiguration, error) {
	if err := validateCurrentConfigurationOptionsRequest(ctx, request); err != nil {
		return nil, err
	}

	result := make([]CurrentConfiguration, len(request.Configurations))
	copy(result, request.Configurations)
	for index := range result {
		options := map[string]any{}
		result[index].Options = &options
	}
	if len(result) == 0 {
		return result, nil
	}

	selectorsByType := make(map[string]map[string]currentConfigurationOptionSelector)
	requiredTypes := map[string]struct{}{}
	requiredSections := map[string]struct{}{}
	for _, configuration := range result {
		if _, known := selectorsByType[configuration.Type]; known {
			continue
		}
		dataSchema, ok := e.catalog.DataSchemaByType(configuration.Type)
		if !ok {
			selectorsByType[configuration.Type] = nil
			continue
		}
		selectors, err := currentConfigurationOptionSelectors(dataSchema)
		if err != nil {
			return nil, err
		}
		selectorsByType[configuration.Type] = selectors
		for _, selector := range selectors {
			for _, typeName := range selector.types {
				requiredTypes[typeName] = struct{}{}
			}
			for _, section := range selector.sections {
				requiredSections[section] = struct{}{}
			}
		}
	}
	if len(requiredTypes) == 0 && len(requiredSections) == 0 {
		return result, nil
	}

	query := CurrentConfigurationOptionCandidatesQuery{
		ProjectID:       request.ProjectID,
		PublicProjectID: request.PublicProjectID,
		IncludeShared:   request.IncludeShared,
		Types:           sortedCurrentConfigurationOptionKeys(requiredTypes),
		Sections:        sortedCurrentConfigurationOptionKeys(requiredSections),
		MaxRows:         currentConfigurationOptionQueryRows,
	}
	candidates, err := e.candidates.ListCurrentConfigurationOptionCandidates(ctx, query)
	if err != nil {
		if contextErr := ctx.Err(); contextErr != nil {
			return nil, contextErr
		}
		return nil, fmt.Errorf("list current configuration option candidates: %w", err)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if len(candidates) > MaxCurrentConfigurationOptionCandidates {
		return nil, ErrCurrentConfigurationOptionsTooLarge
	}

	for index, candidate := range candidates {
		if !currentConfigurationOptionVisible(request, candidate) {
			return nil, ErrInvalidCurrentConfigurationOptionsRequest
		}
		candidate.Label = cloneCurrentAvailableString(candidate.Label)
		candidates[index] = candidate
	}

	optionsByType := make(map[string]map[string][]CurrentConfigurationOption, len(selectorsByType))
	for typeName, selectors := range selectorsByType {
		if len(selectors) == 0 {
			continue
		}
		options := make(map[string][]CurrentConfigurationOption, len(selectors))
		for _, field := range sortedCurrentConfigurationOptionSelectorFields(selectors) {
			selector := selectors[field]
			items := make([]CurrentConfigurationOption, 0)
			for _, candidate := range candidates {
				if currentConfigurationOptionMatches(selector, candidate) {
					items = append(items, candidate)
				}
			}
			options[field] = items
		}
		optionsByType[typeName] = options
	}
	for index := range result {
		options, ok := optionsByType[result[index].Type]
		if !ok {
			continue
		}
		cloned := cloneCurrentConfigurationOptions(options)
		result[index].Options = &cloned
	}
	return result, nil
}

type currentConfigurationOptionSelector struct {
	types    []string
	sections []string
}

func currentConfigurationOptionSelectors(dataSchema map[string]any) (map[string]currentConfigurationOptionSelector, error) {
	selectors := map[string]currentConfigurationOptionSelector{}
	if err := collectCurrentConfigurationOptionSelectors(dataSchema, "", selectors); err != nil {
		return nil, ErrInvalidCurrentConfigurationOptionsRequest
	}
	return selectors, nil
}

func collectCurrentConfigurationOptionSelectors(
	value any,
	parentKey string,
	selectors map[string]currentConfigurationOptionSelector,
) error {
	switch value := value.(type) {
	case map[string]any:
		if rawTypes, ok := value["configuration_types"]; ok {
			types, err := currentConfigurationOptionAnnotation(rawTypes)
			if err != nil {
				return err
			}
			selectors[parentKey] = currentConfigurationOptionSelector{types: types}
		} else if rawSections, ok := value["configuration_sections"]; ok {
			sections, err := currentConfigurationOptionAnnotation(rawSections)
			if err != nil {
				return err
			}
			selectors[parentKey] = currentConfigurationOptionSelector{sections: sections}
		}

		keys := make([]string, 0, len(value))
		for key := range value {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			if err := collectCurrentConfigurationOptionSelectors(value[key], key, selectors); err != nil {
				return err
			}
		}
	case []any:
		for _, item := range value {
			if err := collectCurrentConfigurationOptionSelectors(item, parentKey, selectors); err != nil {
				return err
			}
		}
	}
	return nil
}

func currentConfigurationOptionAnnotation(raw any) ([]string, error) {
	values, ok := raw.([]any)
	if !ok {
		return nil, ErrInvalidCurrentConfigurationOptionsRequest
	}
	result := make([]string, len(values))
	for index, value := range values {
		text, ok := value.(string)
		if !ok {
			return nil, ErrInvalidCurrentConfigurationOptionsRequest
		}
		result[index] = text
	}
	return result, nil
}

func validateCurrentConfigurationOptionsRequest(
	ctx context.Context,
	request CurrentConfigurationOptionsRequest,
) error {
	if ctx == nil || request.ProjectID <= 0 || request.PublicProjectID <= 0 ||
		len(request.Configurations) > MaxCurrentConfigurationListLimit {
		return ErrInvalidCurrentConfigurationOptionsRequest
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	for _, configuration := range request.Configurations {
		if configuration.ProjectID != request.ProjectID {
			return ErrInvalidCurrentConfigurationOptionsRequest
		}
	}
	return nil
}

func currentConfigurationOptionVisible(
	request CurrentConfigurationOptionsRequest,
	option CurrentConfigurationOption,
) bool {
	if option.ProjectID == request.ProjectID {
		return true
	}
	return request.IncludeShared &&
		request.ProjectID != request.PublicProjectID &&
		option.ProjectID == request.PublicProjectID &&
		option.Shared
}

func currentConfigurationOptionMatches(
	selector currentConfigurationOptionSelector,
	option CurrentConfigurationOption,
) bool {
	for _, typeName := range selector.types {
		if option.Type == typeName {
			return true
		}
	}
	for _, section := range selector.sections {
		if option.Section == section {
			return true
		}
	}
	return false
}

func sortedCurrentConfigurationOptionKeys(values map[string]struct{}) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func sortedCurrentConfigurationOptionSelectorFields(
	selectors map[string]currentConfigurationOptionSelector,
) []string {
	fields := make([]string, 0, len(selectors))
	for field := range selectors {
		fields = append(fields, field)
	}
	sort.Strings(fields)
	return fields
}

func cloneCurrentConfigurationOptionItems(items []CurrentConfigurationOption) []CurrentConfigurationOption {
	cloned := make([]CurrentConfigurationOption, len(items))
	for index, item := range items {
		item.Label = cloneCurrentAvailableString(item.Label)
		cloned[index] = item
	}
	return cloned
}

func cloneCurrentConfigurationOptions(
	options map[string][]CurrentConfigurationOption,
) map[string]any {
	cloned := make(map[string]any, len(options))
	for field, items := range options {
		cloned[field] = cloneCurrentConfigurationOptionItems(items)
	}
	return cloned
}
