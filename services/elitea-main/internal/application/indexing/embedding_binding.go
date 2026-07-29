package indexing

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"unicode/utf8"

	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
)

const (
	CurrentEmbeddingBindingSchema = "elitea.index.embedding-binding.v2"
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

// CurrentEmbeddingRuntimeGroup is the exact non-secret LiteLLM model-group
// identity observed during admission. It deliberately excludes deployment,
// endpoint and credential metadata: the current proxy resolves those values
// again when the SDK invokes it.
type CurrentEmbeddingRuntimeGroup struct {
	Name string
}

type CurrentEmbeddingRuntimeReader interface {
	GetCurrentEmbeddingRuntimeGroup(
		context.Context,
		string,
	) (CurrentEmbeddingRuntimeGroup, bool, error)
}

// EmbeddingBinding is an immutable, non-secret admission record. It preserves
// the authoritative default (model_name, model_project_id) tuple and records
// the current proxy's project -> public -> raw route observed at admission.
//
// It is not a deployment pin: the worker passes ModelName to the unchanged SDK,
// and the proxy resolves deployments, endpoints and credentials at execution.
type EmbeddingBinding struct {
	SchemaVersion          string
	ModelName              string
	ResolvedModelGroup     string
	Route                  string
	ModelProjectID         int32
	ConfigurationProjectID int32
	ConfigurationUUID      string
	ConfigurationDigest    runtimedomain.Digest
}

func (b EmbeddingBinding) Validate() error {
	if b.SchemaVersion != CurrentEmbeddingBindingSchema ||
		!validEmbeddingBindingIdentity(b.ModelName) ||
		!validEmbeddingBindingIdentity(b.ResolvedModelGroup) {
		return ErrInvalidCurrentEmbeddingBinding
	}
	switch b.Route {
	case "project", "public":
		if !validPrefixedEmbeddingGroup(b.ResolvedModelGroup, b.ModelName) {
			return ErrInvalidCurrentEmbeddingBinding
		}
	case "raw":
		if b.ResolvedModelGroup != b.ModelName {
			return ErrInvalidCurrentEmbeddingBinding
		}
	default:
		return ErrInvalidCurrentEmbeddingBinding
	}
	if b.ModelProjectID < 0 || b.ConfigurationProjectID < 0 {
		return ErrInvalidCurrentEmbeddingBinding
	}
	hasConfigurationIdentity := b.ConfigurationProjectID != 0 ||
		b.ConfigurationUUID != "" ||
		!b.ConfigurationDigest.IsZero()
	if hasConfigurationIdentity &&
		(b.ConfigurationProjectID <= 0 ||
			!validCanonicalUUID(b.ConfigurationUUID) ||
			b.ConfigurationDigest.IsZero()) {
		return ErrInvalidCurrentEmbeddingBinding
	}
	if b.ModelProjectID != 0 && b.ConfigurationProjectID != 0 &&
		b.ModelProjectID != b.ConfigurationProjectID {
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
		SchemaVersion          string `json:"schema_version"`
		ModelName              string `json:"model_name"`
		ResolvedModelGroup     string `json:"resolved_model_group"`
		Route                  string `json:"route"`
		ModelProjectID         int32  `json:"model_project_id,omitempty"`
		ConfigurationProjectID int32  `json:"configuration_project_id,omitempty"`
		ConfigurationUUID      string `json:"configuration_uuid,omitempty"`
		ConfigurationDigest    string `json:"configuration_digest,omitempty"`
	}{
		SchemaVersion:          b.SchemaVersion,
		ModelName:              b.ModelName,
		ResolvedModelGroup:     b.ResolvedModelGroup,
		Route:                  b.Route,
		ModelProjectID:         b.ModelProjectID,
		ConfigurationProjectID: b.ConfigurationProjectID,
		ConfigurationUUID:      b.ConfigurationUUID,
	}
	if !b.ConfigurationDigest.IsZero() {
		document.ConfigurationDigest = b.ConfigurationDigest.String()
	}
	return json.Marshal(document)
}

func (b EmbeddingBinding) Clone() EmbeddingBinding {
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

// Resolve records the current proxy route without changing it: caller project
// first, shared public project second, then the raw name. preferredProjectID is
// present only when the current model catalog supplied an authoritative default
// tuple; it is retained independently from the observed proxy route.
func (r *CurrentEmbeddingBindingResolver) Resolve(
	ctx context.Context,
	projectID int32,
	modelName string,
	preferredProjectID *int32,
) (EmbeddingBinding, error) {
	if ctx == nil || projectID <= 0 || !validEmbeddingBindingIdentity(modelName) {
		return EmbeddingBinding{}, ErrInvalidCurrentEmbeddingBinding
	}
	if preferredProjectID != nil &&
		(*preferredProjectID != projectID && *preferredProjectID != r.publicProject) {
		return EmbeddingBinding{}, ErrInvalidCurrentEmbeddingBinding
	}
	if err := ctx.Err(); err != nil {
		return EmbeddingBinding{}, err
	}

	groupName, route, err := r.resolveCurrentEmbeddingRoute(ctx, projectID, modelName)
	if err != nil {
		return EmbeddingBinding{}, err
	}
	binding := EmbeddingBinding{
		SchemaVersion:      CurrentEmbeddingBindingSchema,
		ModelName:          modelName,
		ResolvedModelGroup: groupName,
		Route:              route,
	}
	if preferredProjectID != nil {
		binding.ModelProjectID = *preferredProjectID
	}

	configuration, found, err := r.resolveCurrentEmbeddingConfiguration(
		ctx,
		projectID,
		modelName,
		preferredProjectID,
	)
	if err != nil {
		return EmbeddingBinding{}, err
	}
	if found {
		configurationDigest, digestErr := currentEmbeddingConfigurationDigest(
			configuration,
			modelName,
		)
		if digestErr != nil {
			return EmbeddingBinding{}, digestErr
		}
		binding.ConfigurationProjectID = configuration.ProjectID
		binding.ConfigurationUUID = configuration.UUID
		binding.ConfigurationDigest = configurationDigest
	}

	if err := binding.Validate(); err != nil {
		return EmbeddingBinding{}, err
	}
	return binding, nil
}

func (r *CurrentEmbeddingBindingResolver) resolveCurrentEmbeddingRoute(
	ctx context.Context,
	projectID int32,
	modelName string,
) (string, string, error) {
	projectGroup := strconv.FormatInt(int64(projectID), 10) + "_" + modelName
	found, err := r.currentEmbeddingGroupExists(ctx, projectGroup)
	if err != nil {
		return "", "", err
	}
	if found {
		return projectGroup, "project", nil
	}
	if projectID != r.publicProject {
		publicGroup := strconv.FormatInt(int64(r.publicProject), 10) + "_" + modelName
		found, err = r.currentEmbeddingGroupExists(ctx, publicGroup)
		if err != nil {
			return "", "", err
		}
		if found {
			return publicGroup, "public", nil
		}
	}
	// The current proxy deliberately forwards the raw name without first
	// proving that an externally managed LiteLLM group exists.
	return modelName, "raw", nil
}

func (r *CurrentEmbeddingBindingResolver) currentEmbeddingGroupExists(
	ctx context.Context,
	groupName string,
) (bool, error) {
	group, found, err := r.runtime.GetCurrentEmbeddingRuntimeGroup(ctx, groupName)
	if err != nil {
		return false, currentEmbeddingDependencyError(ctx, err)
	}
	if !found {
		return false, nil
	}
	if group.Name != groupName || !validEmbeddingBindingIdentity(group.Name) {
		return false, ErrInvalidCurrentEmbeddingBinding
	}
	return true, nil
}

func (r *CurrentEmbeddingBindingResolver) resolveCurrentEmbeddingConfiguration(
	ctx context.Context,
	projectID int32,
	modelName string,
	preferredProjectID *int32,
) (CurrentEmbeddingConfiguration, bool, error) {
	if preferredProjectID != nil {
		configuration, found, err := r.configurations.FindCurrentEmbeddingConfiguration(
			ctx,
			*preferredProjectID,
			modelName,
			*preferredProjectID == r.publicProject && projectID != r.publicProject,
		)
		if err != nil {
			return CurrentEmbeddingConfiguration{}, false, currentEmbeddingDependencyError(ctx, err)
		}
		if !found {
			return CurrentEmbeddingConfiguration{}, false, ErrCurrentEmbeddingBindingUnavailable
		}
		return configuration, true, nil
	}

	configuration, found, err := r.configurations.FindCurrentEmbeddingConfiguration(
		ctx,
		projectID,
		modelName,
		false,
	)
	if err != nil {
		return CurrentEmbeddingConfiguration{}, false, currentEmbeddingDependencyError(ctx, err)
	}
	if found || projectID == r.publicProject {
		return configuration, found, nil
	}
	configuration, found, err = r.configurations.FindCurrentEmbeddingConfiguration(
		ctx,
		r.publicProject,
		modelName,
		true,
	)
	if err != nil {
		return CurrentEmbeddingConfiguration{}, false, currentEmbeddingDependencyError(ctx, err)
	}
	return configuration, found, nil
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
		UUID          string                               `json:"uuid"`
		ProjectID     int32                                `json:"project_id"`
		Type          string                               `json:"type"`
		Section       string                               `json:"section"`
		Shared        bool                                 `json:"shared"`
		Name          string                               `json:"name"`
		CredentialRef *currentEmbeddingCredentialReference `json:"ai_credentials,omitempty"`
	}{
		UUID:          configuration.UUID,
		ProjectID:     configuration.ProjectID,
		Type:          configuration.Type,
		Section:       configuration.Section,
		Shared:        configuration.Shared,
		Name:          data.Name,
		CredentialRef: data.CredentialRef,
	}
	encoded, err := json.Marshal(canonical)
	if err != nil {
		return runtimedomain.Digest{}, ErrInvalidCurrentEmbeddingBinding
	}
	return runtimedomain.SHA256(encoded), nil
}

type currentEmbeddingCredentialReference struct {
	EliteaTitle string `json:"elitea_title"`
	Private     bool   `json:"private"`
}

type currentEmbeddingConfigurationData struct {
	Name          string
	CredentialRef *currentEmbeddingCredentialReference
}

func decodeCurrentEmbeddingConfigurationData(raw []byte) (currentEmbeddingConfigurationData, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var document struct {
		Name          string                               `json:"name"`
		AICredentials *currentEmbeddingCredentialReference `json:"ai_credentials"`
	}
	if err := decoder.Decode(&document); err != nil {
		return currentEmbeddingConfigurationData{}, ErrInvalidCurrentEmbeddingBinding
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return currentEmbeddingConfigurationData{}, ErrInvalidCurrentEmbeddingBinding
	}
	if !validEmbeddingBindingIdentity(document.Name) ||
		(document.AICredentials != nil &&
			!validEmbeddingBindingIdentity(document.AICredentials.EliteaTitle)) {
		return currentEmbeddingConfigurationData{}, ErrInvalidCurrentEmbeddingBinding
	}
	return currentEmbeddingConfigurationData{
		Name:          document.Name,
		CredentialRef: document.AICredentials,
	}, nil
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
		utf8.ValidString(value) && !strings.ContainsAny(value, "\x00\r\n")
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
			if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
				return false
			}
		}
	}
	return true
}

func validPrefixedEmbeddingGroup(group, model string) bool {
	suffix := "_" + model
	if !strings.HasSuffix(group, suffix) || len(group) <= len(suffix) {
		return false
	}
	prefix := group[:len(group)-len(suffix)]
	for _, character := range prefix {
		if character < '0' || character > '9' {
			return false
		}
	}
	projectID, err := strconv.ParseInt(prefix, 10, 32)
	return err == nil && projectID > 0
}
