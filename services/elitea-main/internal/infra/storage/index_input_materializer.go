package storage

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"regexp"
	"strconv"
	"strings"

	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/centrysecrets"
)

const maxIndexSecretBytes = 32 * 1024

var exactSecretReference = regexp.MustCompile(`^\{\{secret\.([A-Za-z0-9_]+)\}\}$`)

// IndexInputMaterializer redeems only the fixed first-slice GitHub and
// PGVector credential references. It runs after the content server has verified
// the immutable admitted bytes and never mutates that durable source identity.
type IndexInputMaterializer struct {
	vaults          SecretVaultLoader
	publicProjectID int64
}

func NewIndexInputMaterializer(vaults SecretVaultLoader, publicProjectID int64) (*IndexInputMaterializer, error) {
	if vaults == nil || publicProjectID <= 0 {
		return nil, errors.New("index input materializer dependencies are required")
	}
	return &IndexInputMaterializer{vaults: vaults, publicProjectID: publicProjectID}, nil
}

func (m *IndexInputMaterializer) MaterializeContent(ctx context.Context, authorization ContentAuthorization, source []byte, maxBytes int64) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if authorization.CapabilityID != executiondomain.IndexIngestCapability || maxBytes < 1 || len(source) == 0 || int64(len(source)) > maxBytes {
		return nil, ErrContentRejected
	}

	switch authorization.SemanticRole {
	case executiondomain.IndexToolkitConfigurationRole:
		return m.materializeGitHubToolkit(ctx, authorization.ResourceProjectID, source, maxBytes)
	case executiondomain.IndexToolParametersRole:
		return credentialFreeJSONObject(source, maxBytes)
	case executiondomain.IndexLLMModelRole:
		return credentialFreeJSONString(source, maxBytes)
	case executiondomain.IndexLLMConfigurationRole:
		return credentialFreeLLMConfiguration(source, maxBytes)
	default:
		return nil, ErrContentRejected
	}
}

type secretBinding struct {
	configuration map[string]any
	field         string
	projectID     int64
	name          string
}

func (m *IndexInputMaterializer) materializeGitHubToolkit(ctx context.Context, resourceProject string, source []byte, maxBytes int64) ([]byte, error) {
	resourceProjectID, err := canonicalProjectID(resourceProject)
	if err != nil {
		return nil, ErrContentRejected
	}
	root, err := decodeObject(source)
	if err != nil || root["type"] != "github" {
		return nil, ErrContentRejected
	}
	settings, ok := root["settings"].(map[string]any)
	if !ok {
		return nil, ErrContentRejected
	}
	if err := rejectUnexpectedSecretMaterial(root, nil); err != nil {
		return nil, err
	}

	github, ok := settings["github_configuration"].(map[string]any)
	if !ok {
		return nil, ErrContentRejected
	}
	githubBindings, err := configurationBindings(
		github,
		"github",
		resourceProjectID,
		m.publicProjectID,
		[]string{"access_token", "password", "app_private_key"},
		nil,
		map[string]struct{}{
			"elitea_title": {}, "private": {}, "configuration_uuid": {},
			"configuration_project_id": {}, "configuration_type": {},
			"base_url": {}, "app_id": {}, "username": {},
			"access_token": {}, "password": {}, "app_private_key": {},
		},
	)
	if err != nil || !validOptionalString(github["app_id"]) || !validOptionalString(github["username"]) || !nonEmptyString(github["base_url"]) {
		return nil, ErrContentRejected
	}
	if !paired(github["username"], github["password"]) || !paired(github["app_id"], github["app_private_key"]) {
		return nil, ErrContentRejected
	}

	pgvector, ok := settings["pgvector_configuration"].(map[string]any)
	if !ok {
		return nil, ErrContentRejected
	}
	pgvectorBindings, err := configurationBindings(
		pgvector,
		"pgvector",
		resourceProjectID,
		m.publicProjectID,
		[]string{"connection_string"},
		map[string]struct{}{"connection_string": {}},
		map[string]struct{}{
			"elitea_title": {}, "private": {}, "configuration_uuid": {},
			"configuration_project_id": {}, "configuration_type": {},
			"connection_string": {},
		},
	)
	if err != nil {
		return nil, ErrContentRejected
	}

	bindings := append(githubBindings, pgvectorBindings...)
	if err := m.redeem(ctx, bindings, maxBytes, len(source)); err != nil {
		return nil, err
	}
	if err := rejectRemainingSecretReferences(root); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(root)
	if err != nil || len(encoded) == 0 || int64(len(encoded)) > maxBytes {
		clearContentBytes(encoded)
		return nil, ErrContentRejected
	}
	return encoded, nil
}

func configurationBindings(
	configuration map[string]any,
	expectedType string,
	resourceProjectID int64,
	publicProjectID int64,
	secretFields []string,
	requiredFields map[string]struct{},
	allowedFields map[string]struct{},
) ([]secretBinding, error) {
	for field := range configuration {
		if _, allowed := allowedFields[field]; !allowed {
			return nil, ErrContentRejected
		}
	}
	if configuration["configuration_type"] != expectedType || !nonEmptyString(configuration["configuration_uuid"]) || !nonEmptyString(configuration["elitea_title"]) {
		return nil, ErrContentRejected
	}
	private, ok := configuration["private"].(bool)
	if !ok || private {
		return nil, ErrContentRejected
	}
	projectID, ok := positiveJSONInteger(configuration["configuration_project_id"])
	if !ok || (projectID != resourceProjectID && projectID != publicProjectID) {
		return nil, ErrContentRejected
	}

	bindings := make([]secretBinding, 0, len(secretFields))
	for _, field := range secretFields {
		value, present := configuration[field]
		_, required := requiredFields[field]
		if !present || value == nil {
			if required {
				return nil, ErrContentRejected
			}
			continue
		}
		reference, ok := value.(string)
		if !ok {
			return nil, ErrContentRejected
		}
		match := exactSecretReference.FindStringSubmatch(reference)
		if len(match) != 2 {
			return nil, ErrContentRejected
		}
		bindings = append(bindings, secretBinding{
			configuration: configuration,
			field:         field,
			projectID:     projectID,
			name:          match[1],
		})
	}
	return bindings, nil
}

func (m *IndexInputMaterializer) redeem(ctx context.Context, bindings []secretBinding, maxBytes int64, sourceBytes int) error {
	projectVaults := make(map[int64]SecretVault, 2)
	var adminVault SecretVault
	adminLoaded := false
	estimatedBytes := int64(sourceBytes)

	for _, binding := range bindings {
		if err := ctx.Err(); err != nil {
			return err
		}
		vault, loaded := projectVaults[binding.projectID]
		if !loaded {
			var err error
			vault, err = m.vaults.LoadProjectVault(ctx, binding.projectID)
			if err != nil || vault == nil {
				return ErrContentUnavailable
			}
			projectVaults[binding.projectID] = vault
		}
		secret, err := vault.Lookup(binding.name)
		if errors.Is(err, centrysecrets.ErrSecretNotFound) {
			if !adminLoaded {
				adminVault, err = m.vaults.LoadAdminVault(ctx)
				if err != nil || adminVault == nil {
					return ErrContentUnavailable
				}
				adminLoaded = true
			}
			secret, err = adminVault.LookupRegular(binding.name)
		}
		if err != nil {
			return ErrContentRejected
		}
		if len(secret.Value) > maxIndexSecretBytes {
			return ErrContentRejected
		}
		referenceBytes := len(binding.configuration[binding.field].(string))
		estimatedBytes += int64(len(secret.Value) - referenceBytes)
		if estimatedBytes > maxBytes {
			return ErrContentRejected
		}
		binding.configuration[binding.field] = secret.Value
	}
	return nil
}

func credentialFreeJSONObject(source []byte, maxBytes int64) ([]byte, error) {
	value, err := decodeObject(source)
	if err != nil || rejectCredentialFreeMaterial(value) != nil {
		return nil, ErrContentRejected
	}
	return boundedCopy(source, maxBytes)
}

func credentialFreeJSONString(source []byte, maxBytes int64) ([]byte, error) {
	value, err := decodeJSON(source)
	text, ok := value.(string)
	if err != nil || !ok || strings.TrimSpace(text) == "" || strings.Contains(text, "{{secret.") {
		return nil, ErrContentRejected
	}
	return boundedCopy(source, maxBytes)
}

func credentialFreeLLMConfiguration(source []byte, maxBytes int64) ([]byte, error) {
	value, err := decodeObject(source)
	if err != nil {
		return nil, ErrContentRejected
	}
	allowed := map[string]struct{}{
		"temperature": {}, "reasoning_effort": {}, "max_tokens": {},
		"model_name": {}, "model_project_id": {}, "openai_compatible": {},
	}
	for field := range value {
		if _, ok := allowed[field]; !ok {
			return nil, ErrContentRejected
		}
	}
	if rejectCredentialFreeMaterial(value) != nil {
		return nil, ErrContentRejected
	}
	return boundedCopy(source, maxBytes)
}

func rejectCredentialFreeMaterial(value any) error {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			if child != nil && sensitiveCredentialField(key) {
				return ErrContentRejected
			}
			if err := rejectCredentialFreeMaterial(child); err != nil {
				return err
			}
		}
	case []any:
		for _, child := range typed {
			if err := rejectCredentialFreeMaterial(child); err != nil {
				return err
			}
		}
	case string:
		if strings.Contains(typed, "{{secret.") {
			return ErrContentRejected
		}
	}
	return nil
}

func rejectUnexpectedSecretMaterial(value any, path []string) error {
	switch typed := value.(type) {
	case map[string]any:
		for key, child := range typed {
			childPath := append(path, key)
			if isApprovedSecretPath(childPath) {
				continue
			}
			if child != nil && sensitiveCredentialField(key) {
				return ErrContentRejected
			}
			if err := rejectUnexpectedSecretMaterial(child, childPath); err != nil {
				return err
			}
		}
	case []any:
		for _, child := range typed {
			if err := rejectUnexpectedSecretMaterial(child, path); err != nil {
				return err
			}
		}
	case string:
		if strings.Contains(typed, "{{secret.") {
			return ErrContentRejected
		}
	}
	return nil
}

func rejectRemainingSecretReferences(value any) error {
	switch typed := value.(type) {
	case map[string]any:
		for _, child := range typed {
			if err := rejectRemainingSecretReferences(child); err != nil {
				return err
			}
		}
	case []any:
		for _, child := range typed {
			if err := rejectRemainingSecretReferences(child); err != nil {
				return err
			}
		}
	case string:
		if strings.Contains(typed, "{{secret.") {
			return ErrContentRejected
		}
	}
	return nil
}

func isApprovedSecretPath(path []string) bool {
	if len(path) != 3 || path[0] != "settings" {
		return false
	}
	if path[1] == "github_configuration" {
		return path[2] == "access_token" || path[2] == "password" || path[2] == "app_private_key"
	}
	return path[1] == "pgvector_configuration" && path[2] == "connection_string"
}

func sensitiveCredentialField(field string) bool {
	field = strings.ToLower(strings.ReplaceAll(field, "-", "_"))
	switch field {
	case "token", "password", "secret", "credentials", "authorization", "connection_string", "private_key", "api_key":
		return true
	}
	for _, suffix := range []string{"_token", "_password", "_secret", "_credentials", "_connection_string", "_private_key", "_api_key"} {
		if strings.HasSuffix(field, suffix) {
			return true
		}
	}
	return false
}

func canonicalProjectID(value string) (int64, error) {
	projectID, err := strconv.ParseInt(value, 10, 64)
	if err != nil || projectID <= 0 || strconv.FormatInt(projectID, 10) != value {
		return 0, ErrContentRejected
	}
	return projectID, nil
}

func positiveJSONInteger(value any) (int64, bool) {
	number, ok := value.(json.Number)
	if !ok {
		return 0, false
	}
	integer, err := number.Int64()
	return integer, err == nil && integer > 0
}

func nonEmptyString(value any) bool {
	text, ok := value.(string)
	return ok && strings.TrimSpace(text) != ""
}

func validOptionalString(value any) bool {
	if value == nil {
		return true
	}
	_, ok := value.(string)
	return ok
}

func paired(left, right any) bool {
	return presentString(left) == presentString(right)
}

func presentString(value any) bool {
	text, ok := value.(string)
	return ok && strings.TrimSpace(text) != ""
}

func decodeObject(source []byte) (map[string]any, error) {
	value, err := decodeJSON(source)
	if err != nil {
		return nil, err
	}
	object, ok := value.(map[string]any)
	if !ok || object == nil {
		return nil, ErrContentRejected
	}
	return object, nil
}

func decodeJSON(source []byte) (any, error) {
	decoder := json.NewDecoder(bytes.NewReader(source))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, ErrContentRejected
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return nil, ErrContentRejected
	}
	return value, nil
}

func boundedCopy(source []byte, maxBytes int64) ([]byte, error) {
	if len(source) == 0 || int64(len(source)) > maxBytes {
		return nil, ErrContentRejected
	}
	return append([]byte(nil), source...), nil
}
