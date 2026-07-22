package vectorstore

import (
	"context"
	"errors"
	"reflect"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

func TestProjectPgvectorServiceCreatesExactCurrentProjectState(t *testing.T) {
	t.Parallel()

	events := []string{}
	provisioner := &projectDatabaseProvisionerStub{
		passwords: []string{"generated-password"},
		result: DatabaseProvisionResult{
			Status:           "created with existing password",
			Password:         "generated-password",
			ConnectionString: "postgresql+psycopg://project-owned",
		},
		events: &events,
	}
	materials := &projectMaterialRepositoryStub{events: &events}
	configurations := &projectConfigurationRepositoryStub{id: 73, events: &events}
	service := newProjectPgvectorServiceForTest(t, provisioner, materials, configurations)

	label := "Public PgVector"
	request := ProvisionRequest{
		ProjectID:          73,
		ConfigurationTitle: "ELITEA-PGVECTOR",
		ConfigurationLabel: &label,
	}
	result, err := service.Provision(context.Background(), request)
	if err != nil {
		t.Fatalf("Provision() error = %v", err)
	}
	if result.Status != "created with new password" || result.ConfigurationID != 73 {
		t.Fatalf("Provision() result = %+v", result)
	}
	if strings.Contains(result.Status, "project-owned") || strings.Contains(result.Status, "bootstrap-secret") {
		t.Fatalf("Provision() result leaked sensitive material: %+v", result)
	}
	if !reflect.DeepEqual(events, []string{"load", "generate", "provision", "store", "configuration"}) {
		t.Fatalf("event order = %#v", events)
	}

	if len(provisioner.requests) != 1 {
		t.Fatalf("provision requests = %#v", provisioner.requests)
	}
	provisionRequest := provisioner.requests[0]
	if provisionRequest.ProjectID != 73 || provisionRequest.ProjectDatabasePassword != "generated-password" ||
		provisionRequest.Mode != IsolationDatabaseRole {
		t.Fatalf("provision request = %+v", provisionRequest)
	}
	if materials.storedProjectID != 73 || materials.storedPassword != "generated-password" ||
		materials.storedConnectionString != "postgresql+psycopg://project-owned" {
		t.Fatalf("stored material = project %d password %q connection %q", materials.storedProjectID, materials.storedPassword, materials.storedConnectionString)
	}

	configuration := configurations.configuration
	if configuration.ProjectID != 73 || configuration.Title != DefaultProjectPgvectorTitle ||
		configuration.Label == nil || *configuration.Label != label ||
		configuration.Type != ProjectPgvectorType || configuration.Section != ProjectPgvectorSection ||
		configuration.Source != ProjectPgvectorSource ||
		configuration.ConnectionStringReference != ProjectPgvectorReference {
		t.Fatalf("configuration = %+v", configuration)
	}
	if !regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).MatchString(configuration.UUID) {
		t.Fatalf("configuration UUID = %q", configuration.UUID)
	}
	if strings.Contains(configuration.ConnectionStringReference, "project-owned") ||
		strings.Contains(configuration.ConnectionStringReference, "bootstrap-secret") {
		t.Fatalf("configuration leaked sensitive material: %+v", configuration)
	}
}

func TestProjectPgvectorServiceReusesStoredPasswordAndSupportsSchemaMode(t *testing.T) {
	t.Parallel()

	t.Run("database role reuses exact regular vault password", func(t *testing.T) {
		provisioner := &projectDatabaseProvisionerStub{
			result: DatabaseProvisionResult{Status: "password reset", Password: "stored-password", ConnectionString: "project-dsn"},
		}
		materials := &projectMaterialRepositoryStub{password: "stored-password", passwordFound: true}
		configurations := &projectConfigurationRepositoryStub{id: 9}
		service := newProjectPgvectorServiceForTest(t, provisioner, materials, configurations)

		result, err := service.Provision(context.Background(), validProjectProvisionRequest(9))
		if err != nil || result.ConfigurationID != 9 {
			t.Fatalf("Provision() result=%+v error=%v", result, err)
		}
		if provisioner.generateCalls != 0 || provisioner.requests[0].ProjectDatabasePassword != "stored-password" {
			t.Fatalf("generator calls=%d request=%+v", provisioner.generateCalls, provisioner.requests[0])
		}
	})

	t.Run("schema mode keeps current bootstrap-user compatibility", func(t *testing.T) {
		provisioner := &projectDatabaseProvisionerStub{
			result: DatabaseProvisionResult{Status: "created", Password: "bootstrap-password", ConnectionString: "schema-dsn"},
		}
		materials := &projectMaterialRepositoryStub{}
		configurations := &projectConfigurationRepositoryStub{id: 10}
		service := newProjectPgvectorServiceForTest(t, provisioner, materials, configurations)
		request := validProjectProvisionRequest(10)
		request.Mode = IsolationSchema

		_, err := service.Provision(context.Background(), request)
		if err != nil {
			t.Fatal(err)
		}
		if materials.loadCalls != 1 || provisioner.generateCalls != 0 ||
			provisioner.requests[0].ProjectDatabasePassword != "" {
			t.Fatalf("schema mode material/generator calls are wrong: load=%d generate=%d request=%+v", materials.loadCalls, provisioner.generateCalls, provisioner.requests[0])
		}
		if materials.storedPassword != "bootstrap-password" || materials.storedConnectionString != "schema-dsn" {
			t.Fatalf("schema material = password %q connection %q", materials.storedPassword, materials.storedConnectionString)
		}
	})
}

func TestProjectPgvectorServiceExistingMaterialUsesExplicitIntent(t *testing.T) {
	t.Parallel()

	complete := func() *projectMaterialRepositoryStub {
		return &projectMaterialRepositoryStub{
			password:              "stored-password",
			passwordFound:         true,
			connectionString:      "stored-connection",
			connectionStringFound: true,
		}
	}

	t.Run("normal preserves current get-from-secrets fast path", func(t *testing.T) {
		provisioner := &projectDatabaseProvisionerStub{}
		materials := complete()
		configurations := &projectConfigurationRepositoryStub{id: 17}
		service := newProjectPgvectorServiceForTest(t, provisioner, materials, configurations)

		result, err := service.Provision(context.Background(), validProjectProvisionRequest(17))
		if err != nil || result.Status != "got from secrets" || result.ConfigurationID != 17 {
			t.Fatalf("Provision() result=%+v error=%v", result, err)
		}
		if materials.loadCalls != 1 || materials.storeCalls != 0 ||
			provisioner.generateCalls != 0 || len(provisioner.requests) != 0 || configurations.calls != 1 {
			t.Fatalf(
				"fast-path calls = load %d store %d generate %d provision %d configuration %d",
				materials.loadCalls,
				materials.storeCalls,
				provisioner.generateCalls,
				len(provisioner.requests),
				configurations.calls,
			)
		}
	})

	t.Run("same-title identity conflict remains typed and performs no external effect", func(t *testing.T) {
		provisioner := &projectDatabaseProvisionerStub{}
		materials := complete()
		configurations := &projectConfigurationRepositoryStub{
			errors: []error{ErrProjectPgvectorConflict},
		}
		service := newProjectPgvectorServiceForTest(t, provisioner, materials, configurations)

		_, err := service.Provision(context.Background(), validProjectProvisionRequest(17))
		if !errors.Is(err, ErrProjectPgvectorConflict) {
			t.Fatalf("conflict error = %v", err)
		}
		if len(provisioner.requests) != 0 || materials.storeCalls != 0 {
			t.Fatalf("conflict reached external effects: provisions=%d stores=%d", len(provisioner.requests), materials.storeCalls)
		}
	})

	t.Run("repair reuses password and converges external state", func(t *testing.T) {
		provisioner := &projectDatabaseProvisionerStub{resultForRequest: true}
		materials := complete()
		configurations := &projectConfigurationRepositoryStub{id: 18}
		service := newProjectPgvectorServiceForTest(t, provisioner, materials, configurations)
		request := validProjectProvisionRequest(18)
		request.Intent = ProvisionRepair

		_, err := service.Provision(context.Background(), request)
		if err != nil {
			t.Fatal(err)
		}
		if provisioner.generateCalls != 0 || len(provisioner.requests) != 1 ||
			provisioner.requests[0].ProjectDatabasePassword != "stored-password" || materials.storeCalls != 1 {
			t.Fatalf("repair calls = generate %d requests %#v stores %d", provisioner.generateCalls, provisioner.requests, materials.storeCalls)
		}
	})

	t.Run("force recreate generates one explicit rotation password", func(t *testing.T) {
		provisioner := &projectDatabaseProvisionerStub{
			passwords:        []string{"rotated-password"},
			resultForRequest: true,
		}
		materials := complete()
		configurations := &projectConfigurationRepositoryStub{id: 19}
		service := newProjectPgvectorServiceForTest(t, provisioner, materials, configurations)
		request := validProjectProvisionRequest(19)
		request.Intent = ProvisionForceRecreate

		result, err := service.Provision(context.Background(), request)
		if err != nil || result.Status != "password reset" {
			t.Fatalf("Provision() result=%+v error=%v", result, err)
		}
		if provisioner.generateCalls != 1 || len(provisioner.requests) != 1 ||
			provisioner.requests[0].ProjectDatabasePassword != "rotated-password" ||
			materials.storedPassword != "rotated-password" {
			t.Fatalf("force calls = generate %d requests %#v stored %q", provisioner.generateCalls, provisioner.requests, materials.storedPassword)
		}
	})
}

func TestProjectPgvectorServiceFailurePrefixesRemainRetryable(t *testing.T) {
	t.Parallel()

	t.Run("vault failure rotates an otherwise unrecoverable new role on retry", func(t *testing.T) {
		provisioner := &projectDatabaseProvisionerStub{passwords: []string{"first-password", "second-password"}}
		materials := &projectMaterialRepositoryStub{storeErrors: []error{errors.New("vault-detail"), nil}}
		configurations := &projectConfigurationRepositoryStub{id: 7}
		service := newProjectPgvectorServiceForTest(t, provisioner, materials, configurations)

		provisioner.resultForRequest = true
		_, firstErr := service.Provision(context.Background(), validProjectProvisionRequest(7))
		if !errors.Is(firstErr, ErrProjectPgvectorVault) {
			t.Fatalf("first error = %v", firstErr)
		}
		result, secondErr := service.Provision(context.Background(), validProjectProvisionRequest(7))
		if secondErr != nil || result.ConfigurationID != 7 {
			t.Fatalf("second result=%+v error=%v", result, secondErr)
		}
		if len(provisioner.requests) != 2 ||
			provisioner.requests[0].ProjectDatabasePassword != "first-password" ||
			provisioner.requests[1].ProjectDatabasePassword != "second-password" {
			t.Fatalf("retry passwords = %#v", provisioner.requests)
		}
		if configurations.calls != 1 {
			t.Fatalf("configuration calls = %d, want only successful handoff", configurations.calls)
		}
	})

	t.Run("configuration failure keeps vault material for idempotent retry", func(t *testing.T) {
		provisioner := &projectDatabaseProvisionerStub{passwords: []string{"stable-password"}, resultForRequest: true}
		materials := &projectMaterialRepositoryStub{persistStoredPassword: true}
		configurations := &projectConfigurationRepositoryStub{
			id: 8, errors: []error{errors.New("tenant-detail"), nil},
		}
		service := newProjectPgvectorServiceForTest(t, provisioner, materials, configurations)

		_, firstErr := service.Provision(context.Background(), validProjectProvisionRequest(8))
		if !errors.Is(firstErr, ErrProjectPgvectorConfiguration) {
			t.Fatalf("first error = %v", firstErr)
		}
		_, secondErr := service.Provision(context.Background(), validProjectProvisionRequest(8))
		if secondErr != nil {
			t.Fatal(secondErr)
		}
		if provisioner.generateCalls != 1 || len(provisioner.requests) != 1 ||
			configurations.calls != 2 || materials.storeCalls != 1 {
			t.Fatalf(
				"retry did not use complete-material fast path: generate=%d requests=%#v configurations=%d stores=%d",
				provisioner.generateCalls,
				provisioner.requests,
				configurations.calls,
				materials.storeCalls,
			)
		}
	})
}

func TestProjectPgvectorServiceStopsAtEachFailedBoundaryAndRedactsCauses(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name          string
		provisioner   *projectDatabaseProvisionerStub
		materials     *projectMaterialRepositoryStub
		configuration *projectConfigurationRepositoryStub
		want          error
		wantProvision int
		wantStore     int
		wantConfig    int
	}{
		{
			name: "load", provisioner: &projectDatabaseProvisionerStub{},
			materials:     &projectMaterialRepositoryStub{loadErr: errors.New("secret-canary")},
			configuration: &projectConfigurationRepositoryStub{id: 1}, want: ErrProjectPgvectorVault,
		},
		{
			name: "generate", provisioner: &projectDatabaseProvisionerStub{generateErr: errors.New("secret-canary")},
			materials: &projectMaterialRepositoryStub{}, configuration: &projectConfigurationRepositoryStub{id: 1},
			want: ErrProjectPgvectorUnavailable,
		},
		{
			name: "provision", provisioner: &projectDatabaseProvisionerStub{passwords: []string{"password"}, provisionErr: errors.New("secret-canary")},
			materials: &projectMaterialRepositoryStub{}, configuration: &projectConfigurationRepositoryStub{id: 1},
			want: ErrProjectPgvectorUnavailable, wantProvision: 1,
		},
		{
			name: "vault store", provisioner: &projectDatabaseProvisionerStub{passwords: []string{"password"}, result: DatabaseProvisionResult{Password: "password", ConnectionString: "dsn"}},
			materials:     &projectMaterialRepositoryStub{storeErrors: []error{errors.New("secret-canary")}},
			configuration: &projectConfigurationRepositoryStub{id: 1}, want: ErrProjectPgvectorVault, wantProvision: 1, wantStore: 1,
		},
		{
			name: "configuration", provisioner: &projectDatabaseProvisionerStub{passwords: []string{"password"}, result: DatabaseProvisionResult{Password: "password", ConnectionString: "dsn"}},
			materials:     &projectMaterialRepositoryStub{},
			configuration: &projectConfigurationRepositoryStub{errors: []error{errors.New("secret-canary")}},
			want:          ErrProjectPgvectorConfiguration, wantProvision: 1, wantStore: 1, wantConfig: 1,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service := newProjectPgvectorServiceForTest(t, test.provisioner, test.materials, test.configuration)
			_, err := service.Provision(context.Background(), validProjectProvisionRequest(1))
			if !errors.Is(err, test.want) || strings.Contains(err.Error(), "secret-canary") {
				t.Fatalf("Provision() error = %v, want safe %v", err, test.want)
			}
			if len(test.provisioner.requests) != test.wantProvision || test.materials.storeCalls != test.wantStore || test.configuration.calls != test.wantConfig {
				t.Fatalf("calls = provision %d store %d config %d", len(test.provisioner.requests), test.materials.storeCalls, test.configuration.calls)
			}
		})
	}
}

func TestProjectPgvectorServiceValidatesInputAndPreservesCancellation(t *testing.T) {
	t.Parallel()

	service := newProjectPgvectorServiceForTest(
		t,
		&projectDatabaseProvisionerStub{},
		&projectMaterialRepositoryStub{},
		&projectConfigurationRepositoryStub{id: 1},
	)
	invalid := []ProvisionRequest{
		{},
		{ProjectID: -1},
		{ProjectID: 1, Mode: IsolationMode(99)},
		{ProjectID: 1, Intent: ProvisionIntent(99)},
		{ProjectID: 1, ConfigurationTitle: "spaces are invalid"},
		{ProjectID: 1, ConfigurationTitle: strings.Repeat("a", maxCurrentConfigurationTitleBytes+1)},
	}
	for _, request := range invalid {
		if _, err := service.Provision(context.Background(), request); !errors.Is(err, ErrInvalidProjectPgvectorRequest) {
			t.Fatalf("request=%+v error=%v", request, err)
		}
	}
	if _, err := service.Provision(nil, validProjectProvisionRequest(1)); !errors.Is(err, ErrInvalidProjectPgvectorRequest) {
		t.Fatalf("nil context error = %v", err)
	}
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := service.Provision(canceled, validProjectProvisionRequest(1)); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled context error = %v", err)
	}
}

func TestProjectPgvectorServiceConcurrentFirstProvisionKeepsRoleAndVaultConsistent(t *testing.T) {
	t.Parallel()

	provisioner := &lockedProjectDatabaseProvisioner{}
	materials := newConcurrentProjectMaterialRepository()
	configurations := &concurrentProjectConfigurationRepository{}
	service := newProjectPgvectorServiceForTest(t, provisioner, materials, configurations)

	errorsByCall := make(chan error, 2)
	var calls sync.WaitGroup
	calls.Add(2)
	for index := 0; index < 2; index++ {
		go func() {
			defer calls.Done()
			_, err := service.Provision(context.Background(), validProjectProvisionRequest(99))
			errorsByCall <- err
		}()
	}
	calls.Wait()
	close(errorsByCall)
	for err := range errorsByCall {
		if err != nil {
			t.Fatal(err)
		}
	}

	provisioner.mu.Lock()
	databasePassword := provisioner.databasePassword
	provisioner.mu.Unlock()
	materials.mu.Lock()
	vaultPassword := materials.password
	materials.mu.Unlock()
	if databasePassword == "" || vaultPassword != databasePassword {
		t.Fatal("concurrent successful provisioning left the project role and vault inconsistent")
	}
}

func newProjectPgvectorServiceForTest(
	t *testing.T,
	provisioner DatabaseProvisioner,
	materials ProjectMaterialRepository,
	configurations ProjectConfigurationRepository,
) *ProjectPgvectorService {
	t.Helper()
	service, err := NewProjectPgvectorService(provisioner, materials, configurations)
	if err != nil {
		t.Fatal(err)
	}
	return service
}

func validProjectProvisionRequest(projectID int64) ProvisionRequest {
	return ProvisionRequest{ProjectID: projectID}
}

type projectDatabaseProvisionerStub struct {
	passwords        []string
	generateErr      error
	provisionErr     error
	result           DatabaseProvisionResult
	resultForRequest bool
	requests         []DatabaseProvisionRequest
	generateCalls    int
	events           *[]string
}

func (s *projectDatabaseProvisionerStub) NewProjectPassword() (string, error) {
	s.generateCalls++
	appendProjectPgvectorEvent(s.events, "generate")
	if s.generateErr != nil {
		return "", s.generateErr
	}
	if len(s.passwords) == 0 {
		return "", nil
	}
	password := s.passwords[0]
	s.passwords = s.passwords[1:]
	return password, nil
}

func (s *projectDatabaseProvisionerStub) Provision(
	ctx context.Context,
	request DatabaseProvisionRequest,
	handoff func(context.Context, DatabaseProvisionResult) error,
) (DatabaseProvisionResult, error) {
	s.requests = append(s.requests, request)
	appendProjectPgvectorEvent(s.events, "provision")
	if s.provisionErr != nil {
		return DatabaseProvisionResult{}, s.provisionErr
	}
	result := s.result
	if s.resultForRequest {
		result = DatabaseProvisionResult{Status: "password reset", Password: request.ProjectDatabasePassword, ConnectionString: "project-dsn"}
	}
	if err := handoff(ctx, result); err != nil {
		return DatabaseProvisionResult{}, err
	}
	return result, nil
}

type projectMaterialRepositoryStub struct {
	password               string
	passwordFound          bool
	connectionString       string
	connectionStringFound  bool
	loadErr                error
	storeErrors            []error
	persistStoredPassword  bool
	loadCalls              int
	storeCalls             int
	storedProjectID        int64
	storedPassword         string
	storedConnectionString string
	events                 *[]string
}

func (s *projectMaterialRepositoryStub) LoadProjectPgvectorMaterial(_ context.Context, _ int64) (ProjectMaterial, error) {
	s.loadCalls++
	appendProjectPgvectorEvent(s.events, "load")
	return ProjectMaterial{
		Password:              s.password,
		PasswordFound:         s.passwordFound,
		ConnectionString:      s.connectionString,
		ConnectionStringFound: s.connectionStringFound,
	}, s.loadErr
}

func (s *projectMaterialRepositoryStub) StoreProjectPgvectorMaterial(_ context.Context, projectID int64, password, connectionString string) error {
	s.storeCalls++
	appendProjectPgvectorEvent(s.events, "store")
	s.storedProjectID = projectID
	s.storedPassword = password
	s.storedConnectionString = connectionString
	var err error
	if len(s.storeErrors) > 0 {
		err = s.storeErrors[0]
		s.storeErrors = s.storeErrors[1:]
	}
	if err == nil && s.persistStoredPassword {
		s.password = password
		s.passwordFound = true
		s.connectionString = connectionString
		s.connectionStringFound = true
	}
	return err
}

type projectConfigurationRepositoryStub struct {
	id            int32
	errors        []error
	configuration ProjectConfiguration
	calls         int
	events        *[]string
}

func (s *projectConfigurationRepositoryStub) UpsertProjectPgvectorConfiguration(_ context.Context, configuration ProjectConfiguration) (int32, error) {
	s.calls++
	appendProjectPgvectorEvent(s.events, "configuration")
	s.configuration = configuration
	if len(s.errors) > 0 {
		err := s.errors[0]
		s.errors = s.errors[1:]
		if err != nil {
			return 0, err
		}
	}
	return s.id, nil
}

func appendProjectPgvectorEvent(events *[]string, event string) {
	if events != nil {
		*events = append(*events, event)
	}
}

type lockedProjectDatabaseProvisioner struct {
	mu               sync.Mutex
	generated        atomic.Uint32
	databasePassword string
}

func (s *lockedProjectDatabaseProvisioner) NewProjectPassword() (string, error) {
	if s.generated.Add(1) == 1 {
		return "first-password", nil
	}
	return "second-password", nil
}

func (s *lockedProjectDatabaseProvisioner) Provision(
	ctx context.Context,
	request DatabaseProvisionRequest,
	handoff func(context.Context, DatabaseProvisionResult) error,
) (DatabaseProvisionResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.databasePassword = request.ProjectDatabasePassword
	result := DatabaseProvisionResult{
		Status:           "created with existing password",
		Password:         request.ProjectDatabasePassword,
		ConnectionString: "project-connection",
	}
	if err := handoff(ctx, result); err != nil {
		return DatabaseProvisionResult{}, err
	}
	return result, nil
}

type concurrentProjectMaterialRepository struct {
	mu       sync.Mutex
	loads    int
	release  chan struct{}
	password string
}

func newConcurrentProjectMaterialRepository() *concurrentProjectMaterialRepository {
	return &concurrentProjectMaterialRepository{release: make(chan struct{})}
}

func (s *concurrentProjectMaterialRepository) LoadProjectPgvectorMaterial(context.Context, int64) (ProjectMaterial, error) {
	s.mu.Lock()
	s.loads++
	if s.loads == 2 {
		close(s.release)
	}
	release := s.release
	s.mu.Unlock()
	<-release
	// Force both callers to observe the same first-provision state before the
	// provisioner's cross-process project lock orders their handoffs.
	return ProjectMaterial{}, nil
}

func (s *concurrentProjectMaterialRepository) StoreProjectPgvectorMaterial(_ context.Context, _ int64, password, _ string) error {
	s.mu.Lock()
	s.password = password
	s.mu.Unlock()
	return nil
}

type concurrentProjectConfigurationRepository struct {
	next atomic.Int32
}

func (s *concurrentProjectConfigurationRepository) UpsertProjectPgvectorConfiguration(context.Context, ProjectConfiguration) (int32, error) {
	return s.next.Add(1), nil
}
