package configurations

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
)

func TestCurrentConfigurationRenameReferenceEffectRewritesOnlyCredentialReferencesAtAnyListDepth(t *testing.T) {
	settings := json.RawMessage(`{
		"direct":{"elitea_title":"before","private":false,"number":9007199254740993},
		"nested":[[{"wrapper":{"elitea_title":"before","private":true}}]],
		"missing_private":{"elitea_title":"before"},
		"different":{"elitea_title":"another","private":true}
	}`)
	repository := newCurrentConfigurationRenameRepositoryStub(CurrentConfigurationRenameToolkit{
		ToolkitID: 9,
		Version:   "version-1",
		Settings:  settings,
	})
	effect := currentConfigurationRenameReferenceEffectForTest(t, repository)

	err := effect.RenameCurrentConfigurationReferences(context.Background(), currentConfigurationRenameTestEffect())
	if err != nil {
		t.Fatalf("RenameCurrentConfigurationReferences() error = %v", err)
	}
	if repository.successfulCAS != 1 {
		t.Fatalf("successful CAS count = %d", repository.successfulCAS)
	}

	document := currentConfigurationRenameDecodeForTest(t, repository.rows[9].Settings)
	direct := document["direct"].(map[string]any)
	if direct["elitea_title"] != "after" || direct["private"] != false ||
		direct["number"] != json.Number("9007199254740993") {
		t.Fatalf("direct reference = %#v", direct)
	}
	nested := document["nested"].([]any)[0].([]any)[0].(map[string]any)["wrapper"].(map[string]any)
	if nested["elitea_title"] != "after" || nested["private"] != true {
		t.Fatalf("nested reference = %#v", nested)
	}
	if document["missing_private"].(map[string]any)["elitea_title"] != "before" ||
		document["different"].(map[string]any)["elitea_title"] != "another" {
		t.Fatalf("non-reference maps changed: %#v", document)
	}

	// A durable retry sees no old references and performs no second write.
	if err := effect.RenameCurrentConfigurationReferences(context.Background(), currentConfigurationRenameTestEffect()); err != nil {
		t.Fatalf("idempotent retry error = %v", err)
	}
	if repository.successfulCAS != 1 {
		t.Fatalf("successful CAS count after retry = %d", repository.successfulCAS)
	}
}

func TestCurrentConfigurationRenameReferenceEffectReloadsAfterConflictWithoutLosingConcurrentEdit(t *testing.T) {
	repository := newCurrentConfigurationRenameRepositoryStub(CurrentConfigurationRenameToolkit{
		ToolkitID: 9,
		Version:   "version-1",
		Settings:  json.RawMessage(`{"credential":{"elitea_title":"before","private":false}}`),
	})
	repository.conflictsRemaining = 1
	repository.onConflict = func(record CurrentConfigurationRenameToolkit) CurrentConfigurationRenameToolkit {
		record.Version = "version-2"
		record.Settings = json.RawMessage(`{"credential":{"elitea_title":"before","private":false},"concurrent":"preserved"}`)
		return record
	}
	effect := currentConfigurationRenameReferenceEffectForTest(t, repository)

	if err := effect.RenameCurrentConfigurationReferences(context.Background(), currentConfigurationRenameTestEffect()); err != nil {
		t.Fatalf("RenameCurrentConfigurationReferences() error = %v", err)
	}
	if repository.casCalls != 2 || repository.getCalls != 1 || repository.successfulCAS != 1 {
		t.Fatalf("calls: CAS=%d get=%d successful=%d", repository.casCalls, repository.getCalls, repository.successfulCAS)
	}
	document := currentConfigurationRenameDecodeForTest(t, repository.rows[9].Settings)
	if document["concurrent"] != "preserved" ||
		document["credential"].(map[string]any)["elitea_title"] != "after" {
		t.Fatalf("stored settings = %#v", document)
	}
}

func TestCurrentConfigurationRenameReferenceEffectStopsAfterBoundedConflicts(t *testing.T) {
	repository := newCurrentConfigurationRenameRepositoryStub(CurrentConfigurationRenameToolkit{
		ToolkitID: 9,
		Version:   "version-1",
		Settings:  json.RawMessage(`{"credential":{"elitea_title":"before","private":false}}`),
	})
	repository.conflictsRemaining = MaxCurrentConfigurationRenameCASAttempts
	repository.onConflict = func(record CurrentConfigurationRenameToolkit) CurrentConfigurationRenameToolkit {
		record.Version = fmt.Sprintf("version-%d", repository.casCalls+1)
		return record
	}
	effect := currentConfigurationRenameReferenceEffectForTest(t, repository)

	err := effect.RenameCurrentConfigurationReferences(context.Background(), currentConfigurationRenameTestEffect())
	if !errors.Is(err, ErrCurrentConfigurationLifecycleInternalConflict) {
		t.Fatalf("conflict error = %v", err)
	}
	if repository.casCalls != MaxCurrentConfigurationRenameCASAttempts ||
		repository.getCalls != MaxCurrentConfigurationRenameCASAttempts {
		t.Fatalf("calls: CAS=%d get=%d", repository.casCalls, repository.getCalls)
	}
}

func TestCurrentConfigurationRenameReferenceEffectTreatsConcurrentDeleteAsSuccess(t *testing.T) {
	repository := newCurrentConfigurationRenameRepositoryStub(CurrentConfigurationRenameToolkit{
		ToolkitID: 9,
		Version:   "version-1",
		Settings:  json.RawMessage(`{"credential":{"elitea_title":"before","private":false}}`),
	})
	repository.conflictsRemaining = 1
	repository.onConflict = func(record CurrentConfigurationRenameToolkit) CurrentConfigurationRenameToolkit {
		delete(repository.rows, record.ToolkitID)
		return record
	}
	effect := currentConfigurationRenameReferenceEffectForTest(t, repository)

	if err := effect.RenameCurrentConfigurationReferences(context.Background(), currentConfigurationRenameTestEffect()); err != nil {
		t.Fatalf("RenameCurrentConfigurationReferences() error = %v", err)
	}
	if repository.successfulCAS != 0 || repository.getCalls != 1 {
		t.Fatalf("successful CAS=%d get=%d", repository.successfulCAS, repository.getCalls)
	}
}

func TestCurrentConfigurationRenameReferenceEffectEnforcesRowByteDepthAndDocumentBounds(t *testing.T) {
	tests := []struct {
		name       string
		repository *currentConfigurationRenameRepositoryStub
		want       error
	}{
		{
			name: "rows",
			repository: &currentConfigurationRenameRepositoryStub{
				listed: make([]CurrentConfigurationRenameToolkit, MaxCurrentConfigurationRenameToolkits+1),
				rows:   map[int32]CurrentConfigurationRenameToolkit{},
			},
			want: ErrCurrentConfigurationLifecycleInternalLimit,
		},
		{
			name: "settings bytes",
			repository: newCurrentConfigurationRenameRepositoryStub(CurrentConfigurationRenameToolkit{
				ToolkitID: 9,
				Version:   "version-1",
				Settings:  json.RawMessage(strings.Repeat(" ", MaxCurrentConfigurationRenameSettingsBytes+1)),
			}),
			want: ErrCurrentConfigurationLifecycleInternalLimit,
		},
		{
			name: "malformed document",
			repository: newCurrentConfigurationRenameRepositoryStub(CurrentConfigurationRenameToolkit{
				ToolkitID: 9,
				Version:   "version-1",
				Settings:  json.RawMessage(`{"broken":`),
			}),
			want: ErrInvalidCurrentConfigurationLifecycleInternalEffect,
		},
		{
			name: "depth",
			repository: newCurrentConfigurationRenameRepositoryStub(CurrentConfigurationRenameToolkit{
				ToolkitID: 9,
				Version:   "version-1",
				Settings:  currentConfigurationRenameDeepDocumentForTest(t),
			}),
			want: ErrCurrentConfigurationLifecycleInternalLimit,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			effect := currentConfigurationRenameReferenceEffectForTest(t, test.repository)
			err := effect.RenameCurrentConfigurationReferences(context.Background(), currentConfigurationRenameTestEffect())
			if !errors.Is(err, test.want) {
				t.Fatalf("error = %v, want %v", err, test.want)
			}
			if test.repository.successfulCAS != 0 {
				t.Fatalf("successful CAS = %d", test.repository.successfulCAS)
			}
		})
	}
}

func TestCurrentConfigurationRenameReferenceEffectRedactsDependenciesAndPreservesCancellation(t *testing.T) {
	repository := newCurrentConfigurationRenameRepositoryStub()
	repository.listErr = errors.New("database contained secret=must-not-leak")
	effect := currentConfigurationRenameReferenceEffectForTest(t, repository)

	err := effect.RenameCurrentConfigurationReferences(context.Background(), currentConfigurationRenameTestEffect())
	if !errors.Is(err, ErrCurrentConfigurationLifecycleInternalUnavailable) || strings.Contains(err.Error(), "must-not-leak") {
		t.Fatalf("dependency error = %v", err)
	}

	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	err = effect.RenameCurrentConfigurationReferences(cancelled, currentConfigurationRenameTestEffect())
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation error = %v", err)
	}
}

func TestCurrentConfigurationRenameReferenceEffectRejectsInvalidInput(t *testing.T) {
	if _, err := NewCurrentConfigurationRenameReferenceEffect(nil); !errors.Is(err, ErrInvalidCurrentConfigurationLifecycleInternalEffect) {
		t.Fatalf("constructor error = %v", err)
	}
	repository := newCurrentConfigurationRenameRepositoryStub()
	effect := currentConfigurationRenameReferenceEffectForTest(t, repository)
	invalid := currentConfigurationRenameTestEffect()
	invalid.BeforeTitle = invalid.AfterTitle
	if err := effect.RenameCurrentConfigurationReferences(context.Background(), invalid); !errors.Is(err, ErrInvalidCurrentConfigurationLifecycleInternalEffect) {
		t.Fatalf("invalid effect error = %v", err)
	}
	if repository.listCalls != 0 {
		t.Fatalf("list calls = %d", repository.listCalls)
	}
}

func currentConfigurationRenameReferenceEffectForTest(
	t *testing.T,
	repository CurrentConfigurationRenameRepository,
) *CurrentConfigurationRenameReferenceEffect {
	t.Helper()
	effect, err := NewCurrentConfigurationRenameReferenceEffect(repository)
	if err != nil {
		t.Fatalf("NewCurrentConfigurationRenameReferenceEffect() error = %v", err)
	}
	return effect
}

func currentConfigurationRenameTestEffect() CurrentConfigurationRenameEffect {
	return CurrentConfigurationRenameEffect{
		EffectID:          "event-1:dependents:rename",
		EventID:           "event-1",
		Revision:          4,
		ProjectID:         7,
		ConfigurationUUID: "configuration-uuid",
		Type:              "github",
		BeforeTitle:       "before",
		AfterTitle:        "after",
	}
}

func currentConfigurationRenameDecodeForTest(t *testing.T, raw json.RawMessage) map[string]any {
	t.Helper()
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.UseNumber()
	var document map[string]any
	if err := decoder.Decode(&document); err != nil {
		t.Fatalf("decode settings: %v", err)
	}
	return document
}

func currentConfigurationRenameDeepDocumentForTest(t *testing.T) json.RawMessage {
	t.Helper()
	var value any = map[string]any{"elitea_title": "before", "private": false}
	for range MaxCurrentConfigurationRenameDepth {
		value = []any{value}
	}
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal deep document: %v", err)
	}
	return raw
}

type currentConfigurationRenameRepositoryStub struct {
	listed             []CurrentConfigurationRenameToolkit
	rows               map[int32]CurrentConfigurationRenameToolkit
	listErr            error
	getErr             error
	casErr             error
	conflictsRemaining int
	onConflict         func(CurrentConfigurationRenameToolkit) CurrentConfigurationRenameToolkit
	listCalls          int
	getCalls           int
	casCalls           int
	successfulCAS      int
}

func newCurrentConfigurationRenameRepositoryStub(
	records ...CurrentConfigurationRenameToolkit,
) *currentConfigurationRenameRepositoryStub {
	rows := make(map[int32]CurrentConfigurationRenameToolkit, len(records))
	listed := make([]CurrentConfigurationRenameToolkit, len(records))
	for index, record := range records {
		listed[index] = cloneCurrentConfigurationRenameToolkit(record)
		rows[record.ToolkitID] = cloneCurrentConfigurationRenameToolkit(record)
	}
	return &currentConfigurationRenameRepositoryStub{listed: listed, rows: rows}
}

func (s *currentConfigurationRenameRepositoryStub) ListCurrentConfigurationRenameToolkits(
	_ context.Context,
	_ int32,
	limits CurrentConfigurationRenameScanLimits,
) ([]CurrentConfigurationRenameToolkit, error) {
	s.listCalls++
	if limits != (CurrentConfigurationRenameScanLimits{
		MaxRows:          MaxCurrentConfigurationRenameToolkits + 1,
		MaxSettingsBytes: MaxCurrentConfigurationRenameSettingsBytes,
		MaxTotalBytes:    MaxCurrentConfigurationRenameTotalBytes,
	}) {
		return nil, errors.New("unexpected limits")
	}
	result := make([]CurrentConfigurationRenameToolkit, len(s.listed))
	for index, record := range s.listed {
		result[index] = cloneCurrentConfigurationRenameToolkit(record)
	}
	return result, s.listErr
}

func (s *currentConfigurationRenameRepositoryStub) GetCurrentConfigurationRenameToolkit(
	_ context.Context,
	_ int32,
	toolkitID int32,
) (CurrentConfigurationRenameToolkit, bool, error) {
	s.getCalls++
	record, found := s.rows[toolkitID]
	return cloneCurrentConfigurationRenameToolkit(record), found, s.getErr
}

func (s *currentConfigurationRenameRepositoryStub) CompareAndSwapCurrentConfigurationRenameToolkit(
	_ context.Context,
	update CurrentConfigurationRenameToolkitUpdate,
) (bool, error) {
	s.casCalls++
	if s.casErr != nil {
		return false, s.casErr
	}
	record, found := s.rows[update.ToolkitID]
	if s.conflictsRemaining > 0 {
		s.conflictsRemaining--
		if s.onConflict != nil && found {
			record = s.onConflict(record)
			if _, stillPresent := s.rows[update.ToolkitID]; stillPresent {
				s.rows[update.ToolkitID] = cloneCurrentConfigurationRenameToolkit(record)
			}
		}
		return false, nil
	}
	if !found || record.Version != update.ExpectedVersion {
		return false, nil
	}
	record.Version += "-next"
	record.Settings = append(json.RawMessage(nil), update.Settings...)
	s.rows[update.ToolkitID] = record
	for index := range s.listed {
		if s.listed[index].ToolkitID == update.ToolkitID {
			s.listed[index] = cloneCurrentConfigurationRenameToolkit(record)
		}
	}
	s.successfulCAS++
	return true, nil
}

func cloneCurrentConfigurationRenameToolkit(record CurrentConfigurationRenameToolkit) CurrentConfigurationRenameToolkit {
	record.Settings = append(json.RawMessage(nil), record.Settings...)
	return record
}

var _ CurrentConfigurationRenameRepository = (*currentConfigurationRenameRepositoryStub)(nil)
