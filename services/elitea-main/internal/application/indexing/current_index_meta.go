package indexing

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"strconv"
	"strings"
	"time"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
)

const (
	MaxCurrentIndexMetaConnectionStringBytes = 16 << 10
	MaxCurrentInitialIndexMetaBytes          = 1 << 20
)

var (
	ErrCurrentIndexMetaInitializationInvalid      = errors.New("current index metadata initialization is invalid")
	ErrCurrentIndexMetaTargetUnavailable          = errors.New("current index metadata target is unavailable")
	ErrCurrentIndexMetaMaterializationUnavailable = errors.New("current index metadata materialization is unavailable")
	ErrCurrentIndexMetaConflict                   = errors.New("another index execution is already active")
	ErrCurrentIndexMetaSuperseded                 = errors.New("index metadata terminal effect was superseded")
)

// FrozenToolkitConfigurationClaim selects the exact immutable toolkit bytes
// already admitted for one execution. Implementations may redeem the frozen
// secret references, but must not resolve a mutable toolkit/configuration title
// again or retain the returned plaintext.
type FrozenToolkitConfigurationClaim struct {
	ResourceProjectID    int32
	ActorUserID          int32
	ToolkitConfiguration json.RawMessage
}

type FrozenToolkitConfigurationClaimer interface {
	ClaimFrozenToolkitConfiguration(context.Context, FrozenToolkitConfigurationClaim) (json.RawMessage, error)
}

// CurrentIndexMetaTarget exists only for the synchronous external write. The
// connection string is never part of an execution input, output, or error.
type CurrentIndexMetaTarget struct {
	ConnectionString string
	SchemaID         int32
}

// CurrentInitialIndexMeta is the exact initial current-baseline metadata
// generation. InitialMetadata intentionally excludes history: the external
// writer owns the serialized read/append/write transaction for existing rows.
type CurrentInitialIndexMeta struct {
	MetaID          string
	ExecutionID     string
	CorrelationID   string
	Generation      uint64
	IndexGeneration uint64
	IndexName       string
	ToolkitID       int32
	Document        string
	InitialMetadata json.RawMessage
}

func (m CurrentInitialIndexMeta) Validate() error {
	if !validOptionalText(m.MetaID, executiondomain.MaxIndexMetaIDBytes) || m.MetaID == "" ||
		!validOptionalText(m.ExecutionID, maxIndexAdmissionStringBytes) || m.ExecutionID == "" ||
		!validOptionalText(m.CorrelationID, executiondomain.MaxIndexMetaCorrelationBytes) || m.CorrelationID == "" ||
		m.Generation == 0 || m.Generation > math.MaxInt64 ||
		m.IndexGeneration == 0 || m.IndexGeneration > math.MaxInt64 ||
		m.ToolkitID <= 0 ||
		m.IndexName == "" || len(m.IndexName) > maxIndexAdmissionStringBytes ||
		m.Document != "index_meta_"+m.IndexName ||
		len(m.InitialMetadata) == 0 || len(m.InitialMetadata) > MaxCurrentInitialIndexMetaBytes ||
		!validBoundedJSONObject(m.InitialMetadata) {
		return ErrCurrentIndexMetaInitializationInvalid
	}
	return nil
}

// CurrentIndexMetaWriter atomically creates, recovers, or starts a new
// generation in the already-resolved project PgVector target.
type CurrentIndexMetaWriter interface {
	MaterializeInitial(context.Context, CurrentIndexMetaTarget, CurrentInitialIndexMeta) error
}

type CurrentIndexMetaTerminalState string

const (
	CurrentIndexMetaFailed    CurrentIndexMetaTerminalState = "failed"
	CurrentIndexMetaCancelled CurrentIndexMetaTerminalState = "cancelled"
)

// CurrentIndexMetaTerminalBinding is the immutable admission evidence needed
// to terminalize the matching external metadata generation. The frozen toolkit
// bytes contain references only and are redeemed immediately before the write.
type CurrentIndexMetaTerminalBinding struct {
	ResourceProjectID    int32
	ActorUserID          int32
	ToolkitID            int32
	IndexName            string
	MetaID               string
	ExecutionID          string
	Generation           uint64
	IndexGeneration      uint64
	ToolkitConfiguration json.RawMessage
}

func (b CurrentIndexMetaTerminalBinding) Validate() error {
	if b.ResourceProjectID <= 0 || b.ActorUserID <= 0 || b.ToolkitID <= 0 ||
		b.IndexName == "" || len(b.IndexName) > maxIndexAdmissionStringBytes ||
		!validOptionalText(b.MetaID, executiondomain.MaxIndexMetaIDBytes) || b.MetaID == "" ||
		!validOptionalText(b.ExecutionID, maxIndexAdmissionStringBytes) || b.ExecutionID == "" ||
		b.Generation == 0 || b.Generation > math.MaxInt64 ||
		b.IndexGeneration == 0 || b.IndexGeneration > math.MaxInt64 ||
		len(b.ToolkitConfiguration) == 0 ||
		len(b.ToolkitConfiguration) > executiondomain.MaxInputEntryContentBytes ||
		!validBoundedJSONObject(b.ToolkitConfiguration) {
		return ErrCurrentIndexMetaInitializationInvalid
	}
	return nil
}

type CurrentIndexMetaTerminalRequest struct {
	ExecutionID string
	Generation  uint64
	State       CurrentIndexMetaTerminalState
	OccurredAt  time.Time
	SafeError   string
}

type CurrentIndexMetaTerminalResolution string

const (
	CurrentIndexMetaTerminalApplied    CurrentIndexMetaTerminalResolution = "APPLIED"
	CurrentIndexMetaTerminalSuperseded CurrentIndexMetaTerminalResolution = "SUPERSEDED"
)

type CurrentIndexMetaTerminalClaim struct {
	CurrentIndexMetaTerminalRequest
	ClaimToken string
}

func (c CurrentIndexMetaTerminalClaim) Validate() error {
	if err := c.CurrentIndexMetaTerminalRequest.Validate(); err != nil ||
		!validOptionalText(c.ClaimToken, maxIndexAdmissionStringBytes) ||
		c.ClaimToken == "" {
		return ErrCurrentIndexMetaInitializationInvalid
	}
	return nil
}

func (r CurrentIndexMetaTerminalRequest) Validate() error {
	if !validOptionalText(r.ExecutionID, maxIndexAdmissionStringBytes) || r.ExecutionID == "" ||
		r.Generation == 0 || r.Generation > math.MaxInt64 || r.OccurredAt.IsZero() {
		return ErrCurrentIndexMetaInitializationInvalid
	}
	switch r.State {
	case CurrentIndexMetaFailed:
		if !validOptionalText(r.SafeError, maxIndexAdmissionStringBytes) || r.SafeError == "" {
			return ErrCurrentIndexMetaInitializationInvalid
		}
		return nil
	case CurrentIndexMetaCancelled:
		if r.SafeError != "" {
			return ErrCurrentIndexMetaInitializationInvalid
		}
		return nil
	default:
		return ErrCurrentIndexMetaInitializationInvalid
	}
}

type CurrentTerminalIndexMeta struct {
	MetaID          string
	ExecutionID     string
	Generation      uint64
	IndexGeneration uint64
	IndexName       string
	ToolkitID       int32
	State           CurrentIndexMetaTerminalState
	OccurredAt      time.Time
	SafeError       string
}

func (m CurrentTerminalIndexMeta) Validate() error {
	if !validOptionalText(m.MetaID, executiondomain.MaxIndexMetaIDBytes) || m.MetaID == "" ||
		m.IndexGeneration == 0 || m.IndexGeneration > math.MaxInt64 ||
		m.ToolkitID <= 0 || m.IndexName == "" || len(m.IndexName) > maxIndexAdmissionStringBytes {
		return ErrCurrentIndexMetaInitializationInvalid
	}
	return CurrentIndexMetaTerminalRequest{
		ExecutionID: m.ExecutionID,
		Generation:  m.Generation,
		State:       m.State,
		OccurredAt:  m.OccurredAt,
		SafeError:   m.SafeError,
	}.Validate()
}

type CurrentIndexMetaTerminalBindingRepository interface {
	LoadCurrentIndexMetaTerminalBinding(context.Context, string, uint64) (CurrentIndexMetaTerminalBinding, error)
}

type CurrentIndexMetaTerminalWriter interface {
	MaterializeTerminal(context.Context, CurrentIndexMetaTarget, CurrentTerminalIndexMeta) error
}

// CurrentIndexMetaTerminalizer applies a claimed terminal effect discovered
// from durable runtime output or no-authority retirement evidence. The
// standalone reconciler owns retry/backoff; the writer fences and deduplicates
// the exact metadata generation.
type CurrentIndexMetaTerminalizer struct {
	bindings CurrentIndexMetaTerminalBindingRepository
	toolkits FrozenToolkitConfigurationClaimer
	writer   CurrentIndexMetaTerminalWriter
}

func NewCurrentIndexMetaTerminalizer(
	bindings CurrentIndexMetaTerminalBindingRepository,
	toolkits FrozenToolkitConfigurationClaimer,
	writer CurrentIndexMetaTerminalWriter,
) (*CurrentIndexMetaTerminalizer, error) {
	if bindings == nil || toolkits == nil || writer == nil {
		return nil, errors.New("current index metadata terminalizer dependencies are required")
	}
	return &CurrentIndexMetaTerminalizer{bindings: bindings, toolkits: toolkits, writer: writer}, nil
}

func (t *CurrentIndexMetaTerminalizer) Terminalize(
	ctx context.Context,
	request CurrentIndexMetaTerminalRequest,
) error {
	if t == nil || t.bindings == nil || t.toolkits == nil || t.writer == nil || ctx == nil {
		return ErrCurrentIndexMetaInitializationInvalid
	}
	if err := request.Validate(); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	binding, err := t.bindings.LoadCurrentIndexMetaTerminalBinding(ctx, request.ExecutionID, request.Generation)
	if err != nil {
		return currentIndexMetaInitializationError(ctx, err)
	}
	if err := binding.Validate(); err != nil ||
		binding.ExecutionID != request.ExecutionID ||
		binding.Generation != request.Generation {
		return ErrCurrentIndexMetaConflict
	}
	claimed, err := t.toolkits.ClaimFrozenToolkitConfiguration(ctx, FrozenToolkitConfigurationClaim{
		ResourceProjectID:    binding.ResourceProjectID,
		ActorUserID:          binding.ActorUserID,
		ToolkitConfiguration: bytes.Clone(binding.ToolkitConfiguration),
	})
	if err != nil {
		return currentIndexMetaInitializationError(ctx, err)
	}
	target, err := currentIndexMetaTarget(claimed, binding.ToolkitID, binding.ResourceProjectID)
	if err != nil {
		return err
	}
	record := CurrentTerminalIndexMeta{
		MetaID:          binding.MetaID,
		ExecutionID:     binding.ExecutionID,
		Generation:      binding.Generation,
		IndexGeneration: binding.IndexGeneration,
		IndexName:       binding.IndexName,
		ToolkitID:       binding.ToolkitID,
		State:           request.State,
		OccurredAt:      request.OccurredAt.UTC(),
		SafeError:       request.SafeError,
	}
	if err := record.Validate(); err != nil {
		return err
	}
	if err := t.writer.MaterializeTerminal(ctx, target, record); err != nil {
		return currentIndexMetaInitializationError(ctx, err)
	}
	return nil
}

// CurrentIndexMetaInitializer ports the current reset_or_create metadata
// boundary. It resolves only the admitted frozen toolkit snapshot and writes
// the external row; InitializingAdmissionSubmitter opens the durable dispatch
// gate afterwards.
type CurrentIndexMetaInitializer struct {
	toolkits FrozenToolkitConfigurationClaimer
	writer   CurrentIndexMetaWriter
}

func NewCurrentIndexMetaInitializer(
	toolkits FrozenToolkitConfigurationClaimer,
	writer CurrentIndexMetaWriter,
) (*CurrentIndexMetaInitializer, error) {
	if toolkits == nil || writer == nil {
		return nil, errors.New("current index metadata initializer dependencies are required")
	}
	return &CurrentIndexMetaInitializer{toolkits: toolkits, writer: writer}, nil
}

func (i *CurrentIndexMetaInitializer) MaterializeInitialIndexMeta(
	ctx context.Context,
	request SubmitRequest,
	outcome AdmissionOutcome,
) error {
	if ctx == nil || i == nil || i.toolkits == nil || i.writer == nil {
		return ErrCurrentIndexMetaInitializationInvalid
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if request.ToolkitID <= 0 || request.Inputs.validate() != nil ||
		request.Identity.TenantID != request.Identity.ResourceProjectID ||
		request.Identity.ProjectionProjectID != request.Identity.ResourceProjectID ||
		outcome.ExecutionID == "" || outcome.Generation == 0 ||
		outcome.IndexGeneration == 0 || outcome.IndexGeneration > math.MaxInt64 ||
		outcome.IndexMetaID == "" || outcome.IndexMetaCorrelationID == "" ||
		outcome.IndexMetaCorrelationID != request.CorrelationID ||
		outcome.AdmittedAt.IsZero() {
		return ErrCurrentIndexMetaInitializationInvalid
	}
	projectID, ok := currentIndexMetaIdentityID(request.Identity.ResourceProjectID)
	if !ok {
		return ErrCurrentIndexMetaInitializationInvalid
	}
	actorID, ok := currentIndexMetaIdentityID(request.Identity.ActorID)
	if !ok {
		return ErrCurrentIndexMetaInitializationInvalid
	}

	claimed, err := i.toolkits.ClaimFrozenToolkitConfiguration(ctx, FrozenToolkitConfigurationClaim{
		ResourceProjectID:    projectID,
		ActorUserID:          actorID,
		ToolkitConfiguration: bytes.Clone(request.Inputs.ToolkitConfiguration),
	})
	if err != nil {
		return currentIndexMetaInitializationError(ctx, err)
	}
	target, err := currentIndexMetaTarget(claimed, request.ToolkitID, projectID)
	if err != nil {
		return err
	}
	indexName, err := indexNameFromToolParameters(request.Inputs.ToolParameters)
	if err != nil {
		return ErrCurrentIndexMetaInitializationInvalid
	}
	indexConfiguration, err := decodeCurrentIndexMetaObject(request.Inputs.ToolParameters)
	if err != nil {
		return ErrCurrentIndexMetaInitializationInvalid
	}
	createdOn := currentIndexMetaUnixSeconds(outcome.AdmittedAt)
	initial := map[string]any{
		"collection":           indexName,
		"type":                 "index_meta",
		"indexed":              0,
		"updated":              0,
		"state":                "in_progress",
		"index_configuration":  indexConfiguration,
		"created_on":           createdOn,
		"updated_on":           createdOn,
		"task_id":              outcome.ExecutionID,
		"conversation_id":      nil,
		"toolkit_id":           request.ToolkitID,
		"execution_id":         outcome.ExecutionID,
		"execution_generation": outcome.Generation,
		"index_generation":     outcome.IndexGeneration,
		"index_meta_id":        outcome.IndexMetaID,
		"correlation_id":       outcome.IndexMetaCorrelationID,
	}
	encoded, err := json.Marshal(initial)
	if err != nil || len(encoded) == 0 || len(encoded) > MaxCurrentInitialIndexMetaBytes {
		return ErrCurrentIndexMetaInitializationInvalid
	}
	record := CurrentInitialIndexMeta{
		MetaID:          outcome.IndexMetaID,
		ExecutionID:     outcome.ExecutionID,
		CorrelationID:   outcome.IndexMetaCorrelationID,
		Generation:      outcome.Generation,
		IndexGeneration: outcome.IndexGeneration,
		IndexName:       indexName,
		ToolkitID:       request.ToolkitID,
		Document:        "index_meta_" + indexName,
		InitialMetadata: encoded,
	}
	if err := record.Validate(); err != nil {
		return err
	}
	if err := i.writer.MaterializeInitial(ctx, target, record); err != nil {
		return currentIndexMetaInitializationError(ctx, err)
	}
	return nil
}

func currentIndexMetaTarget(
	raw json.RawMessage,
	toolkitID int32,
	projectID int32,
) (CurrentIndexMetaTarget, error) {
	toolkit, err := decodeCurrentIndexMetaObject(raw)
	if err != nil {
		return CurrentIndexMetaTarget{}, ErrCurrentIndexMetaTargetUnavailable
	}
	storedToolkitID, ok := currentIndexMetaInteger(toolkit["id"])
	if !ok || storedToolkitID != int64(toolkitID) {
		return CurrentIndexMetaTarget{}, ErrCurrentIndexMetaTargetUnavailable
	}
	if toolkitType, ok := toolkit["type"].(string); !ok || toolkitType == "" ||
		len(toolkitType) > configurationapp.MaxCurrentToolkitSettingsIdentifier ||
		strings.ContainsAny(toolkitType, "\x00\r\n") {
		return CurrentIndexMetaTarget{}, ErrCurrentIndexMetaTargetUnavailable
	}
	settings, ok := toolkit["settings"].(map[string]any)
	if !ok || settings == nil {
		return CurrentIndexMetaTarget{}, ErrCurrentIndexMetaTargetUnavailable
	}
	pgvectorConfiguration, ok := settings["pgvector_configuration"].(map[string]any)
	if !ok || pgvectorConfiguration == nil ||
		pgvectorConfiguration[configurationapp.CurrentFrozenConfigurationMarker] != nil {
		return CurrentIndexMetaTarget{}, ErrCurrentIndexMetaTargetUnavailable
	}
	configurationType, typeOK := pgvectorConfiguration["configuration_type"].(string)
	configurationProjectID, projectOK := currentIndexMetaInteger(pgvectorConfiguration["configuration_project_id"])
	connectionString, connectionOK := pgvectorConfiguration["connection_string"].(string)
	if !typeOK || configurationType != "pgvector" ||
		!projectOK || configurationProjectID != int64(projectID) ||
		!connectionOK || connectionString == "" ||
		len(connectionString) > MaxCurrentIndexMetaConnectionStringBytes ||
		strings.ContainsAny(connectionString, "\x00\r\n") {
		return CurrentIndexMetaTarget{}, ErrCurrentIndexMetaTargetUnavailable
	}
	return CurrentIndexMetaTarget{
		ConnectionString: connectionString,
		SchemaID:         toolkitID,
	}, nil
}

func decodeCurrentIndexMetaObject(raw []byte) (map[string]any, error) {
	if len(raw) == 0 || len(raw) > MaxCurrentInitialIndexMetaBytes {
		return nil, ErrCurrentIndexMetaInitializationInvalid
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var object map[string]any
	if err := decoder.Decode(&object); err != nil || object == nil {
		return nil, ErrCurrentIndexMetaInitializationInvalid
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return nil, ErrCurrentIndexMetaInitializationInvalid
	}
	return object, nil
}

func currentIndexMetaIdentityID(value string) (int32, bool) {
	parsed, err := strconv.ParseInt(value, 10, 32)
	return int32(parsed), err == nil && parsed > 0 && strconv.FormatInt(parsed, 10) == value
}

func currentIndexMetaInteger(value any) (int64, bool) {
	switch value := value.(type) {
	case json.Number:
		parsed, err := strconv.ParseInt(string(value), 10, 64)
		return parsed, err == nil
	case int:
		return int64(value), true
	case int32:
		return int64(value), true
	case int64:
		return value, true
	case float64:
		if math.IsNaN(value) || math.IsInf(value, 0) || math.Trunc(value) != value ||
			value < math.MinInt64 || value > math.MaxInt64 {
			return 0, false
		}
		return int64(value), true
	default:
		return 0, false
	}
}

func currentIndexMetaUnixSeconds(value time.Time) float64 {
	value = value.UTC()
	return float64(value.Unix()) + float64(value.Nanosecond())/float64(time.Second)
}

func currentIndexMetaInitializationError(ctx context.Context, cause error) error {
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
	if errors.Is(cause, ErrCurrentIndexMetaConflict) {
		return ErrCurrentIndexMetaConflict
	}
	if errors.Is(cause, ErrCurrentIndexMetaSuperseded) {
		return ErrCurrentIndexMetaSuperseded
	}
	if errors.Is(cause, ErrCurrentIndexMetaTargetUnavailable) {
		return ErrCurrentIndexMetaTargetUnavailable
	}
	return ErrCurrentIndexMetaMaterializationUnavailable
}

var _ IndexMetaMaterializer = (*CurrentIndexMetaInitializer)(nil)
