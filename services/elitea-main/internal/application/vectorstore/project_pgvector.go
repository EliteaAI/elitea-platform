// Package vectorstore orchestrates project-owned vector storage without
// exposing bootstrap credentials or project connection strings outside the
// trusted provisioning boundary.
package vectorstore

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"math"
	"strings"
)

const (
	DefaultProjectPgvectorTitle = "elitea-pgvector"
	ProjectPgvectorPasswordKey  = "pgvector_project_password"
	ProjectPgvectorConnstrKey   = "pgvector_project_connstr"
	ProjectPgvectorType         = "pgvector"
	ProjectPgvectorSection      = "vectorstorage"
	ProjectPgvectorSource       = "system"
	ProjectPgvectorReference    = "{{secret.pgvector_project_connstr}}"

	maxCurrentConfigurationTitleBytes = 128
)

var (
	ErrInvalidProjectPgvectorRequest = errors.New("invalid project pgvector request")
	ErrProjectPgvectorUnavailable    = errors.New("project pgvector provisioning unavailable")
	ErrProjectPgvectorVault          = errors.New("project pgvector vault persistence failed")
	ErrProjectPgvectorConfiguration  = errors.New("project pgvector configuration persistence failed")
	ErrProjectPgvectorConflict       = errors.New("project pgvector configuration conflicts with an existing title")
)

// IsolationMode preserves the two current PgVector provisioning modes.
type IsolationMode uint8

const (
	IsolationDatabaseRole IsolationMode = iota
	IsolationSchema
)

// DatabaseProvisionRequest is the external PostgreSQL convergence intent.
// The trusted public-project bootstrap connection is constructor-owned by the
// provisioner and cannot be selected by a request.
type DatabaseProvisionRequest struct {
	ProjectID               int64
	Mode                    IsolationMode
	UseExistingAdminUser    bool
	ProjectDatabasePassword string
}

// DatabaseProvisionResult contains sensitive material only while Provision is
// running. Implementations must return owned strings and redacted errors.
type DatabaseProvisionResult struct {
	Status           string
	Password         string
	ConnectionString string
}

// DatabaseProvisioner owns PostgreSQL resource convergence and the current
// project-password generation contract.
type DatabaseProvisioner interface {
	NewProjectPassword() (string, error)
	Provision(
		context.Context,
		DatabaseProvisionRequest,
		func(context.Context, DatabaseProvisionResult) error,
	) (DatabaseProvisionResult, error)
}

// ProjectMaterial is the current pair stored in the regular project vault.
// Found flags distinguish a missing key from an intentionally empty value;
// provisioning treats either form as incomplete.
type ProjectMaterial struct {
	Password              string
	PasswordFound         bool
	ConnectionString      string
	ConnectionStringFound bool
}

func (m ProjectMaterial) Complete() bool {
	return m.PasswordFound && m.Password != "" &&
		m.ConnectionStringFound && m.ConnectionString != ""
}

// ProjectMaterialRepository reads the current pair together and writes the
// password plus connection string atomically to the encrypted project vault.
type ProjectMaterialRepository interface {
	LoadProjectPgvectorMaterial(context.Context, int64) (ProjectMaterial, error)
	StoreProjectPgvectorMaterial(context.Context, int64, string, string) error
}

// ProjectConfiguration is the exact current system-owned tenant row intent.
// ConnectionStringReference must remain the constant vault placeholder.
type ProjectConfiguration struct {
	UUID                      string
	ProjectID                 int32
	Title                     string
	Label                     *string
	Type                      string
	Section                   string
	Source                    string
	ConnectionStringReference string
}

// ProjectConfigurationRepository idempotently creates the current row or, if
// its title already belongs to the same system PgVector identity, updates only
// data.connection_string. A same-title row with another identity must return
// ErrProjectPgvectorConflict.
type ProjectConfigurationRepository interface {
	UpsertProjectPgvectorConfiguration(context.Context, ProjectConfiguration) (int32, error)
}

type ProvisionRequest struct {
	ProjectID            int64
	Mode                 IsolationMode
	Intent               ProvisionIntent
	UseExistingAdminUser bool
	ConfigurationTitle   string
	ConfigurationLabel   *string
}

// ProvisionIntent makes normal baseline reuse, explicit repair, and explicit
// credential rotation distinguishable. The zero value preserves the current
// get-from-secrets fast path.
type ProvisionIntent uint8

const (
	ProvisionIfMissing ProvisionIntent = iota
	ProvisionRepair
	ProvisionForceRecreate
)

// ProvisionResult deliberately excludes passwords and connection strings.
type ProvisionResult struct {
	Status          string
	ConfigurationID int32
}

// ProjectPgvectorService serially converges one project. PostgreSQL cannot be
// transactionally rolled back with the Centry vault or tenant configuration,
// so the ordering makes every interrupted prefix retryable:
//
//  1. in the normal intent, reuse a complete stored pair without external DDL;
//  2. otherwise reuse or explicitly generate a password and converge the
//     platform-owned database/role (or schema);
//  3. while its per-project lock remains held, atomically store both vault
//     values and idempotently upsert the placeholder-only configuration.
//
// If the vault handoff fails for a first-time database/role, the next attempt generates a
// new password and intentionally rotates the platform-owned role before trying
// the same atomic vault write again. A configuration failure leaves usable
// material in the vault and is repaired by the next idempotent upsert.
type ProjectPgvectorService struct {
	provisioner    DatabaseProvisioner
	materials      ProjectMaterialRepository
	configurations ProjectConfigurationRepository
}

func NewProjectPgvectorService(
	provisioner DatabaseProvisioner,
	materials ProjectMaterialRepository,
	configurations ProjectConfigurationRepository,
) (*ProjectPgvectorService, error) {
	if provisioner == nil || materials == nil || configurations == nil {
		return nil, errors.New("project pgvector dependencies are required")
	}
	return &ProjectPgvectorService{
		provisioner:    provisioner,
		materials:      materials,
		configurations: configurations,
	}, nil
}

func (s *ProjectPgvectorService) Provision(ctx context.Context, request ProvisionRequest) (ProvisionResult, error) {
	if s == nil || s.provisioner == nil || s.materials == nil || s.configurations == nil {
		return ProvisionResult{}, ErrProjectPgvectorUnavailable
	}
	request, err := normalizeProvisionRequest(ctx, request)
	if err != nil {
		return ProvisionResult{}, err
	}
	configurationUUID, err := newUUIDv4()
	if err != nil {
		return ProvisionResult{}, ErrProjectPgvectorUnavailable
	}

	material, err := s.materials.LoadProjectPgvectorMaterial(ctx, request.ProjectID)
	if err != nil {
		return ProvisionResult{}, projectPgvectorDependencyError(ctx, ErrProjectPgvectorVault, err)
	}
	if request.Intent == ProvisionIfMissing && material.Complete() {
		configurationID, err := s.upsertConfiguration(ctx, request, configurationUUID)
		if err != nil {
			return ProvisionResult{}, err
		}
		return ProvisionResult{Status: "got from secrets", ConfigurationID: configurationID}, nil
	}

	password := ""
	generatedPassword := false
	if request.Mode == IsolationDatabaseRole {
		if request.Intent != ProvisionForceRecreate && material.PasswordFound {
			password = material.Password
		}
		if password == "" {
			password, err = s.provisioner.NewProjectPassword()
			if err != nil || password == "" {
				return ProvisionResult{}, projectPgvectorDependencyError(ctx, ErrProjectPgvectorUnavailable, err)
			}
			generatedPassword = true
		}
	}

	configurationID := int32(0)
	provisioned, err := s.provisioner.Provision(ctx, DatabaseProvisionRequest{
		ProjectID:               request.ProjectID,
		Mode:                    request.Mode,
		UseExistingAdminUser:    request.UseExistingAdminUser,
		ProjectDatabasePassword: password,
	}, func(handoffContext context.Context, provisioned DatabaseProvisionResult) error {
		if provisioned.ConnectionString == "" || (request.Mode == IsolationDatabaseRole && provisioned.Password == "") {
			return ErrProjectPgvectorUnavailable
		}
		if err := s.materials.StoreProjectPgvectorMaterial(
			handoffContext,
			request.ProjectID,
			provisioned.Password,
			provisioned.ConnectionString,
		); err != nil {
			return projectPgvectorDependencyError(handoffContext, ErrProjectPgvectorVault, err)
		}

		configurationID, err = s.upsertConfiguration(handoffContext, request, configurationUUID)
		if err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, ErrProjectPgvectorVault) ||
			errors.Is(err, ErrProjectPgvectorConfiguration) ||
			errors.Is(err, ErrProjectPgvectorConflict) {
			return ProvisionResult{}, err
		}
		return ProvisionResult{}, projectPgvectorDependencyError(ctx, ErrProjectPgvectorUnavailable, err)
	}
	if configurationID <= 0 {
		return ProvisionResult{}, ErrProjectPgvectorUnavailable
	}

	status := provisioned.Status
	if generatedPassword && status == "created with existing password" {
		status = "created with new password"
	}
	return ProvisionResult{Status: status, ConfigurationID: configurationID}, nil
}

func (s *ProjectPgvectorService) upsertConfiguration(
	ctx context.Context,
	request ProvisionRequest,
	configurationUUID string,
) (int32, error) {
	configurationID, err := s.configurations.UpsertProjectPgvectorConfiguration(ctx, ProjectConfiguration{
		UUID:                      configurationUUID,
		ProjectID:                 int32(request.ProjectID),
		Title:                     request.ConfigurationTitle,
		Label:                     cloneStringPointer(request.ConfigurationLabel),
		Type:                      ProjectPgvectorType,
		Section:                   ProjectPgvectorSection,
		Source:                    ProjectPgvectorSource,
		ConnectionStringReference: ProjectPgvectorReference,
	})
	if err != nil {
		if errors.Is(err, ErrProjectPgvectorConflict) {
			return 0, err
		}
		return 0, projectPgvectorDependencyError(ctx, ErrProjectPgvectorConfiguration, err)
	}
	if configurationID <= 0 {
		return 0, ErrProjectPgvectorConfiguration
	}
	return configurationID, nil
}

func normalizeProvisionRequest(ctx context.Context, request ProvisionRequest) (ProvisionRequest, error) {
	if ctx == nil || request.ProjectID <= 0 || request.ProjectID > math.MaxInt32 ||
		(request.Mode != IsolationDatabaseRole && request.Mode != IsolationSchema) ||
		(request.Intent != ProvisionIfMissing && request.Intent != ProvisionRepair &&
			request.Intent != ProvisionForceRecreate) {
		return ProvisionRequest{}, ErrInvalidProjectPgvectorRequest
	}
	if err := ctx.Err(); err != nil {
		return ProvisionRequest{}, err
	}
	if request.ConfigurationTitle == "" {
		request.ConfigurationTitle = DefaultProjectPgvectorTitle
	}
	if !validCurrentConfigurationTitle(request.ConfigurationTitle) {
		return ProvisionRequest{}, ErrInvalidProjectPgvectorRequest
	}
	request.ConfigurationTitle = strings.ToLower(request.ConfigurationTitle)
	request.ConfigurationLabel = cloneStringPointer(request.ConfigurationLabel)
	return request, nil
}

func validCurrentConfigurationTitle(value string) bool {
	if value == "" || len(value) > maxCurrentConfigurationTitleBytes {
		return false
	}
	for index := 0; index < len(value); index++ {
		character := value[index]
		if (character >= 'a' && character <= 'z') ||
			(character >= 'A' && character <= 'Z') ||
			(character >= '0' && character <= '9') ||
			character == '_' || character == '-' {
			continue
		}
		return false
	}
	return true
}

func newUUIDv4() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf(
		"%08x-%04x-%04x-%04x-%012x",
		value[0:4],
		value[4:6],
		value[6:8],
		value[8:10],
		value[10:16],
	), nil
}

func cloneStringPointer(value *string) *string {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func projectPgvectorDependencyError(ctx context.Context, safe, cause error) error {
	if ctx != nil {
		if err := ctx.Err(); err != nil {
			return err
		}
	}
	if errors.Is(cause, context.Canceled) {
		return context.Canceled
	}
	if errors.Is(cause, context.DeadlineExceeded) {
		return context.DeadlineExceeded
	}
	return safe
}
