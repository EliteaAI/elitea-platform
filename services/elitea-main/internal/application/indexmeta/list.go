// Package indexmeta reads the current index metadata representation from the
// project-owned PgVector database. HTTP authorization and route parsing remain
// transport concerns; this package accepts only already-authorized numeric
// identities and resolves storage from saved toolkit/configuration state.
package indexmeta

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"reflect"
	"strconv"
	"strings"
	"time"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
)

const (
	MaxCurrentIndexMetaRows          = 10_000
	MaxCurrentIndexMetaIDBytes       = 4 << 10
	MaxCurrentIndexMetaMetadataBytes = 1 << 20
	MaxCurrentIndexMetaTotalBytes    = 16 << 20
	MaxCurrentPgvectorDSNBytes       = 16 << 10
)

var (
	ErrInvalidCurrentIndexMetaRequest = errors.New("invalid current index meta request")
	ErrCurrentIndexMetaToolkitMissing = errors.New("current index meta toolkit is not visible")
	ErrCurrentIndexMetaTargetMissing  = errors.New("current index meta storage target is unavailable")
	ErrCurrentIndexMetaUnavailable    = errors.New("current index meta is unavailable")
	ErrCurrentIndexMetaLimitExceeded  = errors.New("current index meta result exceeds its limit")
	ErrCurrentIndexMetaInvalid        = errors.New("current index meta result is invalid")
)

// Request contains only identities derived from the authenticated request.
// Neither a PgVector DSN nor a PostgreSQL schema is accepted from HTTP input.
type Request struct {
	ProjectID   int64
	ActorUserID int64
	ToolkitID   int64
}

// Item is the exact current UI list element. A non-nil empty []Item serializes
// as [] rather than the incompatible {items,total} prototype response.
type Item struct {
	ID       string         `json:"id"`
	Metadata map[string]any `json:"metadata"`
	Stale    bool           `json:"stale"`
}

// ResolvedTarget is created only after the service loads a saved toolkit and
// expands its Configurations-owned settings. SchemaID is the saved toolkit ID;
// adapters must derive and quote the PostgreSQL identifier from this integer.
type ResolvedTarget struct {
	ConnectionString string
	SchemaID         int32
	MaxRows          int
	MaxMetadataBytes int
	MaxTotalBytes    int
}

// RawRecord is one bounded row returned by the external PgVector adapter.
// Metadata is owned by the caller and must contain exactly one JSON object.
type RawRecord struct {
	ID       string
	Metadata json.RawMessage
}

// ExternalReader reads only the target resolved by Service. Implementations
// must enforce every target bound before returning records and redact DSNs from
// errors.
type ExternalReader interface {
	List(context.Context, ResolvedTarget) ([]RawRecord, error)
}

// StaleTimeoutResolver loads the current project-level
// task_disconnected_timeout_sec value. Missing values must resolve to the
// current 7200-second default rather than failing the request.
type StaleTimeoutResolver interface {
	ResolveCurrentIndexMetaStaleTimeout(context.Context, int32) (time.Duration, error)
}

// Service ports the current index_meta GET path without giving provider or
// credential ownership to the indexer. It is safe for concurrent use when its
// injected readers are safe.
type Service struct {
	toolkits indexingapp.CurrentToolkitReader
	settings indexingapp.CurrentToolkitSettingsValidator
	timeouts StaleTimeoutResolver
	reader   ExternalReader
	now      func() time.Time
}

func NewService(
	toolkits indexingapp.CurrentToolkitReader,
	settings indexingapp.CurrentToolkitSettingsValidator,
	timeouts StaleTimeoutResolver,
	reader ExternalReader,
) (*Service, error) {
	return newService(toolkits, settings, timeouts, reader, time.Now)
}

func newService(
	toolkits indexingapp.CurrentToolkitReader,
	settings indexingapp.CurrentToolkitSettingsValidator,
	timeouts StaleTimeoutResolver,
	reader ExternalReader,
	now func() time.Time,
) (*Service, error) {
	if toolkits == nil || settings == nil || timeouts == nil || reader == nil || now == nil {
		return nil, errors.New("current index meta dependencies are required")
	}
	return &Service{
		toolkits: toolkits,
		settings: settings,
		timeouts: timeouts,
		reader:   reader,
		now:      now,
	}, nil
}

// List returns the current-baseline response array in the external store's
// ordering. The connection string exists only for this synchronous call and is
// never copied into the result or an error.
func (s *Service) List(ctx context.Context, request Request) ([]Item, error) {
	if s == nil || s.toolkits == nil || s.settings == nil || s.timeouts == nil || s.reader == nil || s.now == nil ||
		ctx == nil || request.ProjectID <= 0 || request.ProjectID > math.MaxInt32 ||
		request.ActorUserID <= 0 || request.ActorUserID > math.MaxInt32 ||
		request.ToolkitID <= 0 || request.ToolkitID > math.MaxInt32 {
		return nil, ErrInvalidCurrentIndexMetaRequest
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	target, err := ResolveCurrentTarget(
		ctx,
		s.toolkits,
		s.settings,
		request,
		MaxCurrentIndexMetaRows,
	)
	if err != nil {
		return nil, err
	}
	projectID := int32(request.ProjectID)
	timeout, err := s.timeouts.ResolveCurrentIndexMetaStaleTimeout(ctx, projectID)
	if err != nil {
		return nil, currentIndexMetaDependencyError(ctx, ErrCurrentIndexMetaUnavailable, err)
	}
	records, err := s.reader.List(ctx, target)
	if err != nil {
		if errors.Is(err, ErrCurrentIndexMetaLimitExceeded) {
			return nil, ErrCurrentIndexMetaLimitExceeded
		}
		return nil, currentIndexMetaDependencyError(ctx, ErrCurrentIndexMetaUnavailable, err)
	}
	if len(records) > MaxCurrentIndexMetaRows {
		return nil, ErrCurrentIndexMetaLimitExceeded
	}

	result := make([]Item, 0, len(records))
	now := s.now()
	totalBytes := 0
	for _, record := range records {
		if record.ID == "" || len(record.ID) > MaxCurrentIndexMetaIDBytes ||
			len(record.Metadata) == 0 || len(record.Metadata) > MaxCurrentIndexMetaMetadataBytes {
			return nil, ErrCurrentIndexMetaInvalid
		}
		totalBytes += len(record.ID) + len(record.Metadata)
		if totalBytes > MaxCurrentIndexMetaTotalBytes {
			return nil, ErrCurrentIndexMetaLimitExceeded
		}
		metadata, err := decodeCurrentMetadata(record.Metadata)
		if err != nil {
			return nil, ErrCurrentIndexMetaInvalid
		}
		decodeCurrentNestedJSON(metadata, "index_configuration")
		decodeCurrentNestedJSON(metadata, "history")
		markCurrentFirstHistoryEntryCreated(metadata)
		omitCurrentHistoryChunkingConfig(metadata)
		stale, err := currentIndexIsStale(metadata, now, timeout)
		if err != nil {
			return nil, ErrCurrentIndexMetaInvalid
		}
		result = append(result, Item{ID: record.ID, Metadata: metadata, Stale: stale})
	}
	return result, nil
}

// ResolveCurrentTarget loads only the saved PgVector reference needed by an
// index metadata operation and resolves it in ClaimMode. Callers receive the
// DSN for one synchronous adapter call and must not retain or log it.
func ResolveCurrentTarget(
	ctx context.Context,
	toolkits indexingapp.CurrentToolkitReader,
	settings indexingapp.CurrentToolkitSettingsValidator,
	request Request,
	maxRows int,
) (ResolvedTarget, error) {
	if ctx == nil || toolkits == nil || settings == nil ||
		request.ProjectID <= 0 || request.ProjectID > math.MaxInt32 ||
		request.ActorUserID <= 0 || request.ActorUserID > math.MaxInt32 ||
		request.ToolkitID <= 0 || request.ToolkitID > math.MaxInt32 ||
		maxRows <= 0 || maxRows > MaxCurrentIndexMetaRows {
		return ResolvedTarget{}, ErrInvalidCurrentIndexMetaRequest
	}
	if err := ctx.Err(); err != nil {
		return ResolvedTarget{}, err
	}
	projectID := int32(request.ProjectID)
	actorUserID := int32(request.ActorUserID)
	toolkitID := int32(request.ToolkitID)
	toolkit, found, err := toolkits.GetCurrentToolkit(
		ctx,
		projectID,
		actorUserID,
		toolkitID,
	)
	if err != nil {
		return ResolvedTarget{}, currentIndexMetaDependencyError(
			ctx,
			ErrCurrentIndexMetaUnavailable,
			err,
		)
	}
	if !found {
		return ResolvedTarget{}, ErrCurrentIndexMetaToolkitMissing
	}
	return ResolveCurrentTargetSnapshot(
		ctx,
		settings,
		request,
		toolkit,
		maxRows,
	)
}

// ResolveCurrentTargetSnapshot expands the saved PgVector reference from one
// caller-owned toolkit snapshot. It avoids a second toolkit read when a caller
// must keep metadata inspection and subsequent execution on the same settings.
func ResolveCurrentTargetSnapshot(
	ctx context.Context,
	settings indexingapp.CurrentToolkitSettingsValidator,
	request Request,
	toolkit indexingapp.CurrentToolkitSnapshot,
	maxRows int,
) (ResolvedTarget, error) {
	if ctx == nil || settings == nil ||
		request.ProjectID <= 0 || request.ProjectID > math.MaxInt32 ||
		request.ActorUserID <= 0 || request.ActorUserID > math.MaxInt32 ||
		request.ToolkitID <= 0 || request.ToolkitID > math.MaxInt32 ||
		maxRows <= 0 || maxRows > MaxCurrentIndexMetaRows {
		return ResolvedTarget{}, ErrInvalidCurrentIndexMetaRequest
	}
	if err := ctx.Err(); err != nil {
		return ResolvedTarget{}, err
	}
	projectID := int32(request.ProjectID)
	actorUserID := int32(request.ActorUserID)
	toolkitID := int32(request.ToolkitID)
	if toolkit.ID != toolkitID || toolkit.ID <= 0 || toolkit.Type == "" ||
		len(toolkit.Type) > configurationapp.MaxCurrentToolkitSettingsIdentifier ||
		strings.ContainsAny(toolkit.Type, "\x00\r\n") ||
		toolkit.Settings == nil {
		return ResolvedTarget{}, ErrCurrentIndexMetaTargetMissing
	}

	// Reading index metadata needs exactly one schema-declared configuration.
	// Do not materialize unrelated provider, model, nested-toolkit, or secret
	// fields merely to discover the project PgVector target.
	pgvectorReference, present := toolkit.Settings["pgvector_configuration"]
	if !present || pgvectorReference == nil {
		return ResolvedTarget{}, ErrCurrentIndexMetaTargetMissing
	}
	expanded, err := settings.Resolve(
		ctx,
		configurationapp.CurrentToolkitSettingsRequest{
			ToolkitType: toolkit.Type,
			Settings: map[string]any{
				"pgvector_configuration": pgvectorReference,
			},
			ProjectID: projectID,
			UserID:    actorUserID,
			Mode:      configurationapp.CurrentToolkitSettingsClaimMode,
		},
	)
	if err != nil {
		return ResolvedTarget{}, currentIndexMetaDependencyError(
			ctx,
			ErrCurrentIndexMetaTargetMissing,
			err,
		)
	}
	connectionString, ok := currentPgvectorConnectionString(expanded)
	if !ok {
		return ResolvedTarget{}, ErrCurrentIndexMetaTargetMissing
	}
	return ResolvedTarget{
		ConnectionString: connectionString,
		SchemaID:         toolkit.ID,
		MaxRows:          maxRows,
		MaxMetadataBytes: MaxCurrentIndexMetaMetadataBytes,
		MaxTotalBytes:    MaxCurrentIndexMetaTotalBytes,
	}, nil
}

func currentPgvectorConnectionString(settings map[string]any) (string, bool) {
	if settings == nil {
		return "", false
	}
	configuration, ok := settings["pgvector_configuration"].(map[string]any)
	if !ok || configuration == nil {
		return "", false
	}
	connectionString, ok := configuration["connection_string"].(string)
	if !ok || connectionString == "" || len(connectionString) > MaxCurrentPgvectorDSNBytes ||
		strings.ContainsAny(connectionString, "\x00\r\n") {
		return "", false
	}
	return connectionString, true
}

func decodeCurrentMetadata(raw []byte) (map[string]any, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var metadata map[string]any
	if err := decoder.Decode(&metadata); err != nil || metadata == nil {
		return nil, ErrCurrentIndexMetaInvalid
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return nil, ErrCurrentIndexMetaInvalid
	}
	return metadata, nil
}

// The current Python path stores these two fields as JSON strings in older
// rows and as native JSON in newer rows. A malformed historical string is left
// unchanged, matching its best-effort decode behavior.
func decodeCurrentNestedJSON(metadata map[string]any, key string) {
	encoded, ok := metadata[key].(string)
	if !ok {
		return
	}
	decoder := json.NewDecoder(strings.NewReader(encoded))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return
	}
	metadata[key] = value
}

func markCurrentFirstHistoryEntryCreated(metadata map[string]any) {
	history, ok := metadata["history"].([]any)
	if !ok || len(history) == 0 {
		return
	}
	first, ok := history[0].(map[string]any)
	if !ok {
		return
	}
	if first["state"] == "completed" {
		first["state"] = "created"
		return
	}
	if first["state"] != "in_progress" || len(history) < 2 ||
		!currentHistoryCountIsZero(first["indexed"]) ||
		!currentHistoryCountIsZero(first["updated"]) {
		return
	}
	// Earlier target builds let Main and the SDK write adjacent entries for
	// one run. Repair only that exact, zero-count bootstrap in the response;
	// persisted history remains untouched.
	second, ok := history[1].(map[string]any)
	if !ok || !currentHistoryStateIsTerminal(second["state"]) ||
		!currentHistoryEntriesHaveSameRun(first, second) {
		return
	}
	first["state"] = "created"
}

// omitCurrentHistoryChunkingConfig drops the chunking configuration from the
// per-run history entries of one list element. Each entry is a full clone of
// the top level, so the SDK's ~3.4 KB default chunking_config is repeated once
// per run and is what made this response grow linearly (issue #297). Nothing
// reads it from a history entry: reindex, the edit form and the scheduler all
// take the top-level index_configuration, which stays whole here, and the
// exact (detail) read still returns every entry verbatim. Persisted history is
// untouched, exactly like the created-marker repair above.
func omitCurrentHistoryChunkingConfig(metadata map[string]any) {
	history, ok := metadata["history"].([]any)
	if !ok {
		return
	}
	for _, value := range history {
		entry, ok := value.(map[string]any)
		if !ok {
			continue
		}
		switch configuration := entry["index_configuration"].(type) {
		case map[string]any:
			delete(configuration, "chunking_config")
		case string:
			// Rows written by the earlier Python path nest this object as a
			// JSON string. Keep that shape so callers see the same type.
			trimmed, ok := currentConfigurationWithoutChunking(configuration)
			if ok {
				entry["index_configuration"] = trimmed
			}
		}
	}
}

func currentConfigurationWithoutChunking(encoded string) (string, bool) {
	if len(encoded) > MaxCurrentIndexMetaMetadataBytes {
		return "", false
	}
	configuration := map[string]any{}
	decoder := json.NewDecoder(strings.NewReader(encoded))
	decoder.UseNumber()
	if err := decoder.Decode(&configuration); err != nil || configuration == nil {
		return "", false
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return "", false
	}
	if _, present := configuration["chunking_config"]; !present {
		return "", false
	}
	delete(configuration, "chunking_config")
	trimmed, err := json.Marshal(configuration)
	if err != nil {
		return "", false
	}
	return string(trimmed), true
}

func currentHistoryEntriesHaveSameRun(first, second map[string]any) bool {
	for _, key := range []string{
		"index_meta_id",
		"execution_id",
		"execution_generation",
		"index_generation",
	} {
		if first[key] == nil ||
			!reflect.DeepEqual(first[key], second[key]) {
			return false
		}
	}
	return true
}

func currentHistoryStateIsTerminal(value any) bool {
	state, ok := value.(string)
	if !ok {
		return false
	}
	switch state {
	case "completed", "failed", "partly_indexed", "cancelled",
		"scheduled_reindex":
		return true
	default:
		return false
	}
}

func currentHistoryCountIsZero(value any) bool {
	count, ok := currentUnixSeconds(value)
	return ok && count == 0
}

func currentIndexIsStale(metadata map[string]any, now time.Time, timeout time.Duration) (bool, error) {
	state, _ := metadata["state"].(string)
	if state != "in_progress" {
		return false, nil
	}

	updatedOn := float64(0)
	if value, exists := metadata["updated_on"]; exists {
		var ok bool
		updatedOn, ok = currentUnixSeconds(value)
		if !ok {
			return false, ErrCurrentIndexMetaInvalid
		}
	}
	nowSeconds := float64(now.Unix()) + float64(now.Nanosecond())/float64(time.Second)
	return nowSeconds-updatedOn > timeout.Seconds(), nil
}

func currentUnixSeconds(value any) (float64, bool) {
	switch value := value.(type) {
	case json.Number:
		seconds, err := strconv.ParseFloat(string(value), 64)
		return seconds, err == nil && !math.IsNaN(seconds) && !math.IsInf(seconds, 0)
	case float64:
		return value, !math.IsNaN(value) && !math.IsInf(value, 0)
	case float32:
		seconds := float64(value)
		return seconds, !math.IsNaN(seconds) && !math.IsInf(seconds, 0)
	case int:
		return float64(value), true
	case int8:
		return float64(value), true
	case int16:
		return float64(value), true
	case int32:
		return float64(value), true
	case int64:
		return float64(value), true
	case uint:
		return float64(value), true
	case uint8:
		return float64(value), true
	case uint16:
		return float64(value), true
	case uint32:
		return float64(value), true
	case uint64:
		return float64(value), true
	default:
		return 0, false
	}
}

func currentIndexMetaDependencyError(ctx context.Context, safe, cause error) error {
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
