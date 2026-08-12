package configurations

import (
	"sort"
	"strconv"
	"strings"
)

type CurrentModelSection string

const (
	CurrentModelSectionLLM             CurrentModelSection = "llm"
	CurrentModelSectionEmbedding       CurrentModelSection = "embedding"
	CurrentModelSectionVectorStorage   CurrentModelSection = "vectorstorage"
	CurrentModelSectionImageGeneration CurrentModelSection = "image_generation"
	CurrentModelSectionASR             CurrentModelSection = "asr"
	CurrentModelSectionTTS             CurrentModelSection = "tts"
)

const (
	defaultLLMContextWindow   = 128000
	defaultLLMMaxOutputTokens = 16000
)

// CurrentModelCatalogItem is the union of the current model-list response
// shapes. Pointer fields distinguish a present false/zero value from a field
// that is absent for another section.
type CurrentModelCatalogItem struct {
	Name              string  `json:"name"`
	DisplayName       *string `json:"display_name,omitempty"`
	ProjectID         int32   `json:"project_id"`
	Shared            bool    `json:"shared"`
	ContextWindow     *int    `json:"context_window,omitempty"`
	MaxOutputTokens   *int    `json:"max_output_tokens,omitempty"`
	SupportsReasoning *bool   `json:"supports_reasoning,omitempty"`
	SupportsVision    *bool   `json:"supports_vision,omitempty"`
	LowTier           *bool   `json:"low_tier,omitempty"`
	HighTier          *bool   `json:"high_tier,omitempty"`
	OpenAICompatible  *bool   `json:"openai_compatible,omitempty"`
	Default           bool    `json:"default"`
}

// CurrentModelDefault identifies one configured model. ProjectID is canonical
// decimal text because the current secrets may contain either a JSON number or
// string and compare both through their string representation.
type CurrentModelDefault struct {
	Name      string
	ProjectID string
}

// CurrentModelDefaultSources carries already-read project and public values.
// The application seam performs the current per-field project-then-public
// fallback without knowing whether the adapter reads Vault or another store.
type CurrentModelDefaultSources struct {
	Project CurrentModelDefault
	Public  CurrentModelDefault
}

type CurrentModelCatalogDefaults struct {
	Model    CurrentModelDefaultSources
	LowTier  CurrentModelDefaultSources
	HighTier CurrentModelDefaultSources
}

type CurrentModelCatalogRequest struct {
	Section           CurrentModelSection
	ProjectID         int32
	PublicProjectID   int32
	IncludeShared     bool
	ProjectItems      []CurrentModelCatalogItem
	PublicSharedItems []CurrentModelCatalogItem
	Defaults          CurrentModelCatalogDefaults
}

type CurrentModelCatalogResponse struct {
	Total                 int                       `json:"total"`
	Items                 []CurrentModelCatalogItem `json:"items"`
	DefaultModelName      *string                   `json:"default_model_name"`
	DefaultModelProjectID *int32                    `json:"default_model_project_id"`

	LowTierDefaultModelName      *string `json:"low_tier_default_model_name,omitempty"`
	LowTierDefaultModelProjectID any     `json:"low_tier_default_model_project_id,omitempty"`
	HighTierDefaultModelName     *string `json:"high_tier_default_model_name,omitempty"`
	// The tier project-ID fields intentionally preserve the current mixed wire
	// contract: an int32 for an explicit match and "" when no match exists.
	HighTierDefaultModelProjectID any `json:"high_tier_default_model_project_id,omitempty"`
}

func IsSupportedCurrentModelSection(section CurrentModelSection) bool {
	switch section {
	case CurrentModelSectionLLM,
		CurrentModelSectionEmbedding,
		CurrentModelSectionVectorStorage,
		CurrentModelSectionImageGeneration,
		CurrentModelSectionASR,
		CurrentModelSectionTTS:
		return true
	default:
		return false
	}
}

// BuildCurrentModelCatalog reproduces the pure selection and response-shaping
// behavior of the current ModelConfigurationService. Fetching configurations
// and defaults remains the responsibility of adapters outside this seam.
func BuildCurrentModelCatalog(request CurrentModelCatalogRequest) CurrentModelCatalogResponse {
	response := CurrentModelCatalogResponse{Items: []CurrentModelCatalogItem{}}
	if !IsSupportedCurrentModelSection(request.Section) {
		return response
	}

	items := deduplicateCurrentModelItems(request.Section, request.ProjectItems, nil, false)
	if request.IncludeShared && request.ProjectID != request.PublicProjectID {
		items = deduplicateCurrentModelItems(request.Section, request.PublicSharedItems, items, true)
	}

	defaultName, defaultProjectID := selectCurrentModelDefault(items, resolveCurrentModelDefault(request.Defaults.Model), true, nil)
	for index := range items {
		items[index].Default = defaultName != nil && defaultProjectID != nil &&
			items[index].Name == *defaultName && items[index].ProjectID == *defaultProjectID
	}
	sortCurrentModelItems(items)

	response.Total = len(items)
	response.Items = items
	response.DefaultModelName = defaultName
	response.DefaultModelProjectID = defaultProjectID
	if request.Section == CurrentModelSectionLLM {
		populateCurrentLLMTierDefaults(&response, items, request.Defaults)
	}
	return response
}

func deduplicateCurrentModelItems(
	section CurrentModelSection,
	candidates, existing []CurrentModelCatalogItem,
	sharedOnly bool,
) []CurrentModelCatalogItem {
	type modelKey struct {
		projectID int32
		name      string
	}

	items := make([]CurrentModelCatalogItem, len(existing))
	copy(items, existing)
	indexes := make(map[modelKey]int, len(items)+len(candidates))
	for index, item := range items {
		indexes[modelKey{projectID: item.ProjectID, name: item.Name}] = index
	}
	for _, candidate := range candidates {
		if sharedOnly && !candidate.Shared {
			continue
		}
		candidate = normalizeCurrentModelItem(section, candidate)
		key := modelKey{projectID: candidate.ProjectID, name: candidate.Name}
		if index, ok := indexes[key]; ok {
			items[index] = candidate
			continue
		}
		indexes[key] = len(items)
		items = append(items, candidate)
	}
	return items
}

func normalizeCurrentModelItem(section CurrentModelSection, item CurrentModelCatalogItem) CurrentModelCatalogItem {
	item.Default = false
	if section == CurrentModelSectionLLM {
		item.ContextWindow = currentModelIntDefault(item.ContextWindow, defaultLLMContextWindow)
		item.MaxOutputTokens = currentModelIntDefault(item.MaxOutputTokens, defaultLLMMaxOutputTokens)
		item.SupportsReasoning = currentModelBoolDefault(item.SupportsReasoning, false)
		item.SupportsVision = currentModelBoolDefault(item.SupportsVision, true)
		item.LowTier = currentModelBoolDefault(item.LowTier, false)
		item.HighTier = currentModelBoolDefault(item.HighTier, false)
		item.OpenAICompatible = currentModelBoolDefault(item.OpenAICompatible, false)
		return item
	}

	item.ContextWindow = nil
	item.MaxOutputTokens = nil
	item.SupportsReasoning = nil
	item.SupportsVision = nil
	item.LowTier = nil
	item.HighTier = nil
	item.OpenAICompatible = nil
	if section == CurrentModelSectionVectorStorage {
		item.DisplayName = nil
	}
	return item
}

func currentModelIntDefault(value *int, fallback int) *int {
	if value != nil {
		copied := *value
		return &copied
	}
	return &fallback
}

func currentModelBoolDefault(value *bool, fallback bool) *bool {
	if value != nil {
		copied := *value
		return &copied
	}
	return &fallback
}

func resolveCurrentModelDefault(sources CurrentModelDefaultSources) CurrentModelDefault {
	resolved := sources.Project
	if resolved.Name == "" {
		resolved.Name = sources.Public.Name
	}
	if resolved.ProjectID == "" {
		resolved.ProjectID = sources.Public.ProjectID
	}
	return resolved
}

func selectCurrentModelDefault(
	items []CurrentModelCatalogItem,
	configured CurrentModelDefault,
	fallbackToFirst bool,
	capability func(CurrentModelCatalogItem) bool,
) (*string, *int32) {
	if configured.Name != "" && configured.ProjectID != "" {
		for _, item := range items {
			if item.Name != configured.Name || strconv.FormatInt(int64(item.ProjectID), 10) != configured.ProjectID {
				continue
			}
			if capability != nil && !capability(item) {
				return nil, nil
			}
			name := item.Name
			projectID := item.ProjectID
			return &name, &projectID
		}
	}
	if fallbackToFirst && len(items) > 0 {
		name := items[0].Name
		projectID := items[0].ProjectID
		return &name, &projectID
	}
	return nil, nil
}

func populateCurrentLLMTierDefaults(response *CurrentModelCatalogResponse, items []CurrentModelCatalogItem, defaults CurrentModelCatalogDefaults) {
	empty := ""
	response.LowTierDefaultModelName = &empty
	response.LowTierDefaultModelProjectID = ""
	response.HighTierDefaultModelName = &empty
	response.HighTierDefaultModelProjectID = ""

	lowName, lowProjectID := selectCurrentModelDefault(items, resolveCurrentModelDefault(defaults.LowTier), false, func(item CurrentModelCatalogItem) bool {
		return item.LowTier != nil && *item.LowTier
	})
	if lowName != nil && lowProjectID != nil {
		response.LowTierDefaultModelName = lowName
		response.LowTierDefaultModelProjectID = *lowProjectID
	}

	highName, highProjectID := selectCurrentModelDefault(items, resolveCurrentModelDefault(defaults.HighTier), false, func(item CurrentModelCatalogItem) bool {
		return item.HighTier != nil && *item.HighTier
	})
	if highName != nil && highProjectID != nil {
		response.HighTierDefaultModelName = highName
		response.HighTierDefaultModelProjectID = *highProjectID
	}
}

func sortCurrentModelItems(items []CurrentModelCatalogItem) {
	sort.SliceStable(items, func(left, right int) bool {
		if items[left].Shared != items[right].Shared {
			return items[left].Shared
		}
		return strings.ToLower(currentModelDisplayName(items[left])) < strings.ToLower(currentModelDisplayName(items[right]))
	})
}

func currentModelDisplayName(item CurrentModelCatalogItem) string {
	if item.DisplayName != nil && *item.DisplayName != "" {
		return *item.DisplayName
	}
	return item.Name
}
