package indexing

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"

	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
)

const (
	CurrentEmbeddingBindingSchema = "elitea.index.embedding-binding.v1"
	maxEmbeddingBindingIdentity   = 1024
)

var (
	ErrCurrentEmbeddingBindingUnavailable = errors.New("current embedding binding is unavailable")
	ErrCurrentEmbeddingBindingAmbiguous   = errors.New("current embedding binding is ambiguous")
	ErrInvalidCurrentEmbeddingBinding     = errors.New("invalid current embedding binding")
)

// CurrentEmbeddingConfiguration is the non-secret identity of one current
// Configurations row. Data must remain the saved model configuration, not an
// unsecreted or LiteLLM-expanded value.
type CurrentEmbeddingConfiguration struct {
	UUID      string
	ProjectID int32
	Type      string
	Section   string
	Data      json.RawMessage
	Shared    bool
}

// CurrentEmbeddingConfigurationReader performs one tenant-routed exact-name
// lookup. sharedOnly is true only for the public-project fallback.
type CurrentEmbeddingConfigurationReader interface {
	FindCurrentEmbeddingConfiguration(
		context.Context,
		int32,
		string,
		bool,
	) (CurrentEmbeddingConfiguration, bool, error)
}

// CurrentEmbeddingRuntimeDeployment contains only allowlisted non-secret
// LiteLLM metadata. DeploymentID is deliberately absent: LiteLLM's model_info.id
// is an operational deployment identity, not an embedding-model version.
type CurrentEmbeddingRuntimeDeployment struct {
	ConfigurationUUID string
	Provider          string
	ModelVersion      string
	Dimension         *uint32
}

// CurrentEmbeddingRuntimeGroup is the exact current project-prefixed LiteLLM
// model group and its deployments. Implementations must omit credentials,
// endpoints, headers and arbitrary model_info/litellm_params fields.
type CurrentEmbeddingRuntimeGroup struct {
	Name        string
	Providers   []string
	Deployments []CurrentEmbeddingRuntimeDeployment
}

type CurrentEmbeddingRuntimeReader interface {
	GetCurrentEmbeddingRuntimeGroup(
		context.Context,
		string,
	) (CurrentEmbeddingRuntimeGroup, bool, error)
}

// EmbeddingBinding is an immutable, non-secret description of the embedding
// behavior selected for one logical index generation. ModelVersion and
// Dimension remain absent unless the runtime supplies explicit authoritative
// values; neither is inferred from a model name.
type EmbeddingBinding struct {
	SchemaVersion          string
	ModelName              string
	ResolvedModelGroup     string
	ConfigurationProjectID int32
	ConfigurationUUID      string
	ConfigurationDigest    runtimedomain.Digest
	Provider               string
	ModelVersion           string
	Dimension              *uint32
}

func (b EmbeddingBinding) Validate() error {
	if b.SchemaVersion != CurrentEmbeddingBindingSchema ||
		!validEmbeddingBindingIdentity(b.ModelName) ||
		!validEmbeddingBindingIdentity(b.ResolvedModelGroup) ||
		b.ConfigurationProjectID <= 0 ||
		!validCanonicalUUID(b.ConfigurationUUID) ||
		b.ConfigurationDigest.IsZero() ||
		!validEmbeddingBindingIdentity(b.Provider) {
		return ErrInvalidCurrentEmbeddingBinding
	}
	for _, optional := range []string{b.ModelVersion} {
		if optional != "" && !validEmbeddingBindingIdentity(optional) {
			return ErrInvalidCurrentEmbeddingBinding
		}
	}
	if b.Dimension != nil && *b.Dimension == 0 {
		return ErrInvalidCurrentEmbeddingBinding
	}
	return nil
}

// MarshalCanonical returns the exact non-secret bytes stored in the input data
// plane. Redis receives only their immutable entry reference and digest.
func (b EmbeddingBinding) MarshalCanonical() ([]byte, error) {
	if err := b.Validate(); err != nil {
		return nil, err
	}
	document := struct {
		SchemaVersion          string  `json:"schema_version"`
		ModelName              string  `json:"model_name"`
		ResolvedModelGroup     string  `json:"resolved_model_group"`
		ConfigurationProjectID int32   `json:"configuration_project_id"`
		ConfigurationUUID      string  `json:"configuration_uuid"`
		ConfigurationDigest    string  `json:"configuration_digest"`
		Provider               string  `json:"provider"`
		ModelVersion           string  `json:"model_version,omitempty"`
		Dimension              *uint32 `json:"dimension,omitempty"`
	}{
		SchemaVersion:          b.SchemaVersion,
		ModelName:              b.ModelName,
		ResolvedModelGroup:     b.ResolvedModelGroup,
		ConfigurationProjectID: b.ConfigurationProjectID,
		ConfigurationUUID:      b.ConfigurationUUID,
		ConfigurationDigest:    b.ConfigurationDigest.String(),
		Provider:               b.Provider,
		ModelVersion:           b.ModelVersion,
		Dimension:              cloneUint32(b.Dimension),
	}
	return json.Marshal(document)
}

func (b EmbeddingBinding) Clone() EmbeddingBinding {
	b.Dimension = cloneUint32(b.Dimension)
	return b
}

type CurrentEmbeddingBindingResolver struct {
	configurations CurrentEmbeddingConfigurationReader
	runtime        CurrentEmbeddingRuntimeReader
	publicProject  int32
}

func NewCurrentEmbeddingBindingResolver(
	configurations CurrentEmbeddingConfigurationReader,
	runtime CurrentEmbeddingRuntimeReader,
	publicProjectID int32,
) (*CurrentEmbeddingBindingResolver, error) {
	if configurations == nil || runtime == nil || publicProjectID <= 0 {
		return nil, errors.New("current embedding binding dependencies are required")
	}
	return &CurrentEmbeddingBindingResolver{
		configurations: configurations,
		runtime:        runtime,
		publicProject:  publicProjectID,
	}, nil
}

// Resolve reproduces the current managed-model selection relevant to indexing:
// project configuration first, then shared public configuration. The external
// raw-name LiteLLM fallback is intentionally not accepted because it has no
// Configurations-owned immutable identity to bind.
func (r *CurrentEmbeddingBindingResolver) Resolve(
	ctx context.Context,
	projectID int32,
	modelName string,
) (EmbeddingBinding, error) {
	if ctx == nil || projectID <= 0 || !validEmbeddingBindingIdentity(modelName) {
		return EmbeddingBinding{}, ErrInvalidCurrentEmbeddingBinding
	}
	if err := ctx.Err(); err != nil {
		return EmbeddingBinding{}, err
	}

	configuration, found, err := r.configurations.FindCurrentEmbeddingConfiguration(
		ctx,
		projectID,
		modelName,
		false,
	)
	if err != nil {
		return EmbeddingBinding{}, currentEmbeddingDependencyError(ctx, err)
	}
	if !found && projectID != r.publicProject {
		configuration, found, err = r.configurations.FindCurrentEmbeddingConfiguration(
			ctx,
			r.publicProject,
			modelName,
			true,
		)
		if err != nil {
			return EmbeddingBinding{}, currentEmbeddingDependencyError(ctx, err)
		}
	}
	if !found {
		return EmbeddingBinding{}, ErrCurrentEmbeddingBindingUnavailable
	}

	configurationDigest, err := currentEmbeddingConfigurationDigest(configuration, modelName)
	if err != nil {
		return EmbeddingBinding{}, err
	}
	groupName := strconv.FormatInt(int64(configuration.ProjectID), 10) + "_" + modelName
	group, found, err := r.runtime.GetCurrentEmbeddingRuntimeGroup(ctx, groupName)
	if err != nil {
		return EmbeddingBinding{}, currentEmbeddingDependencyError(ctx, err)
	}
	if !found {
		return EmbeddingBinding{}, ErrCurrentEmbeddingBindingUnavailable
	}
	provider, modelVersion, dimension, err := selectCurrentEmbeddingRuntime(
		group,
		groupName,
		configuration.UUID,
	)
	if err != nil {
		return EmbeddingBinding{}, err
	}

	binding := EmbeddingBinding{
		SchemaVersion:          CurrentEmbeddingBindingSchema,
		ModelName:              modelName,
		ResolvedModelGroup:     groupName,
		ConfigurationProjectID: configuration.ProjectID,
		ConfigurationUUID:      configuration.UUID,
		ConfigurationDigest:    configurationDigest,
		Provider:               provider,
		ModelVersion:           modelVersion,
		Dimension:              dimension,
	}
	if err := binding.Validate(); err != nil {
		return EmbeddingBinding{}, err
	}
	return binding, nil
}

func currentEmbeddingConfigurationDigest(
	configuration CurrentEmbeddingConfiguration,
	modelName string,
) (runtimedomain.Digest, error) {
	if configuration.ProjectID <= 0 ||
		configuration.Type != "embedding_model" ||
		configuration.Section != "embedding" ||
		!validCanonicalUUID(configuration.UUID) {
		return runtimedomain.Digest{}, ErrInvalidCurrentEmbeddingBinding
	}
	data, err := decodeCurrentEmbeddingConfigurationData(configuration.Data)
	if err != nil || data.Name != modelName {
		return runtimedomain.Digest{}, ErrInvalidCurrentEmbeddingBinding
	}
	canonical := struct {
		UUID          string `json:"uuid"`
		ProjectID     int32  `json:"project_id"`
		Type          string `json:"type"`
		Section       string `json:"section"`
		Shared        bool   `json:"shared"`
		Name          string `json:"name"`
		CredentialRef struct {
			EliteaTitle string `json:"elitea_title"`
			Private     bool   `json:"private"`
		} `json:"ai_credentials"`
	}{
		UUID:      configuration.UUID,
		ProjectID: configuration.ProjectID,
		Type:      configuration.Type,
		Section:   configuration.Section,
		Shared:    configuration.Shared,
		Name:      data.Name,
	}
	canonical.CredentialRef.EliteaTitle = data.CredentialTitle
	canonical.CredentialRef.Private = data.CredentialPrivate
	encoded, err := json.Marshal(canonical)
	if err != nil {
		return runtimedomain.Digest{}, ErrInvalidCurrentEmbeddingBinding
	}
	return runtimedomain.SHA256(encoded), nil
}

type currentEmbeddingConfigurationData struct {
	Name              string
	CredentialTitle   string
	CredentialPrivate bool
}

func decodeCurrentEmbeddingConfigurationData(raw []byte) (currentEmbeddingConfigurationData, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var document struct {
		Name          string `json:"name"`
		AICredentials struct {
			EliteaTitle string `json:"elitea_title"`
			Private     bool   `json:"private"`
		} `json:"ai_credentials"`
	}
	if err := decoder.Decode(&document); err != nil {
		return currentEmbeddingConfigurationData{}, ErrInvalidCurrentEmbeddingBinding
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return currentEmbeddingConfigurationData{}, ErrInvalidCurrentEmbeddingBinding
	}
	if !validEmbeddingBindingIdentity(document.Name) ||
		!validEmbeddingBindingIdentity(document.AICredentials.EliteaTitle) {
		return currentEmbeddingConfigurationData{}, ErrInvalidCurrentEmbeddingBinding
	}
	return currentEmbeddingConfigurationData{
		Name:              document.Name,
		CredentialTitle:   document.AICredentials.EliteaTitle,
		CredentialPrivate: document.AICredentials.Private,
	}, nil
}

func selectCurrentEmbeddingRuntime(
	group CurrentEmbeddingRuntimeGroup,
	groupName string,
	configurationUUID string,
) (string, string, *uint32, error) {
	if group.Name != groupName || !validEmbeddingBindingIdentity(group.Name) ||
		len(group.Providers) == 0 || len(group.Deployments) == 0 {
		return "", "", nil, ErrCurrentEmbeddingBindingUnavailable
	}
	providers := uniqueSortedEmbeddingStrings(group.Providers)
	if len(providers) != 1 || !validEmbeddingBindingIdentity(providers[0]) {
		return "", "", nil, ErrCurrentEmbeddingBindingAmbiguous
	}

	var selected *CurrentEmbeddingRuntimeDeployment
	for index := range group.Deployments {
		deployment := group.Deployments[index]
		if deployment.ConfigurationUUID != configurationUUID {
			continue
		}
		if deployment.Provider == "" {
			deployment.Provider = providers[0]
		}
		if deployment.Provider != providers[0] ||
			(deployment.ModelVersion != "" && !validEmbeddingBindingIdentity(deployment.ModelVersion)) ||
			(deployment.Dimension != nil && *deployment.Dimension == 0) {
			return "", "", nil, ErrCurrentEmbeddingBindingAmbiguous
		}
		if selected == nil {
			copied := deployment
			copied.Dimension = cloneUint32(deployment.Dimension)
			selected = &copied
			continue
		}
		if selected.Provider != deployment.Provider ||
			selected.ModelVersion != deployment.ModelVersion ||
			!equalOptionalUint32(selected.Dimension, deployment.Dimension) {
			return "", "", nil, ErrCurrentEmbeddingBindingAmbiguous
		}
	}
	if selected == nil {
		return "", "", nil, ErrCurrentEmbeddingBindingUnavailable
	}
	return selected.Provider, selected.ModelVersion, cloneUint32(selected.Dimension), nil
}

func uniqueSortedEmbeddingStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func currentEmbeddingDependencyError(ctx context.Context, err error) error {
	if contextErr := ctx.Err(); contextErr != nil {
		return contextErr
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	return fmt.Errorf("%w", ErrCurrentEmbeddingBindingUnavailable)
}

func validEmbeddingBindingIdentity(value string) bool {
	return value != "" && len(value) <= maxEmbeddingBindingIdentity &&
		!strings.ContainsAny(value, "\x00\r\n")
}

func validCanonicalUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for index, character := range value {
		switch index {
		case 8, 13, 18, 23:
			if character != '-' {
				return false
			}
		default:
			if !((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f')) {
				return false
			}
		}
	}
	return true
}

func cloneUint32(value *uint32) *uint32 {
	if value == nil {
		return nil
	}
	copied := *value
	return &copied
}

func equalOptionalUint32(left, right *uint32) bool {
	return (left == nil && right == nil) ||
		(left != nil && right != nil && *left == *right)
}
