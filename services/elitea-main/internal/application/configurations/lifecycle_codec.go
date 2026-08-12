package configurations

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
)

const currentConfigurationLifecycleSchemaVersion = 1

// currentConfigurationLifecycleEnvelope is the single durable JSON contract
// shared by the mutation producer and lifecycle processor. Event identity,
// tenant identity, revision, and the digest remain typed outbox columns; the
// envelope carries only the versioned reconciliation intent.
type currentConfigurationLifecycleEnvelope struct {
	SchemaVersion int                                    `json:"schema_version"`
	Operation     CurrentConfigurationLifecycleOperation `json:"operation"`
	ActorID       int32                                  `json:"actor_id"`
	Before        *currentConfigurationLifecycleSnapshot `json:"before,omitempty"`
	After         *currentConfigurationLifecycleSnapshot `json:"after,omitempty"`
}

type currentConfigurationLifecycleSnapshot struct {
	ID            int32          `json:"id"`
	UUID          string         `json:"uuid"`
	ProjectID     int32          `json:"project_id"`
	EliteaTitle   string         `json:"elitea_title"`
	Type          string         `json:"type"`
	Section       string         `json:"section"`
	Label         *string        `json:"label"`
	Shared        bool           `json:"shared"`
	StatusOK      bool           `json:"status_ok"`
	Source        string         `json:"source"`
	AuthorID      *int32         `json:"author_id"`
	DataAvailable bool           `json:"data_available"`
	Data          map[string]any `json:"data"`
}

// EncodeCurrentConfigurationLifecycleIntent emits the exact bounded outbox
// payload consumed by the lifecycle processor. The caller remains responsible
// for validating identity and proving that Data contains only sealed secret
// references before persisting these bytes.
func EncodeCurrentConfigurationLifecycleIntent(intent CurrentConfigurationLifecycleIntent) ([]byte, error) {
	envelope := currentConfigurationLifecycleEnvelope{
		SchemaVersion: currentConfigurationLifecycleSchemaVersion,
		Operation:     intent.Operation,
		ActorID:       intent.ActorID,
		Before:        encodeCurrentConfigurationLifecycleSnapshot(intent.Before),
		After:         encodeCurrentConfigurationLifecycleSnapshot(intent.After),
	}
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	// Keep admitted '<', '>', and '&' bytes compact. The digest authenticates
	// the exact stored representation, so producer and consumer share this
	// encoder instead of independently recreating its output.
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(envelope); err != nil {
		clear(buffer.Bytes())
		return nil, ErrInvalidCurrentConfigurationMutation
	}
	encoded := buffer.Bytes()
	if len(encoded) > 0 && encoded[len(encoded)-1] == '\n' {
		encoded = encoded[:len(encoded)-1]
	}
	if !json.Valid(encoded) {
		clear(encoded)
		return nil, ErrInvalidCurrentConfigurationMutation
	}
	return encoded, nil
}

func decodeCurrentConfigurationLifecycleIntent(
	encoded []byte,
	eventID string,
) (CurrentConfigurationLifecycleIntent, error) {
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.DisallowUnknownFields()
	var envelope currentConfigurationLifecycleEnvelope
	if err := decoder.Decode(&envelope); err != nil {
		return CurrentConfigurationLifecycleIntent{}, ErrInvalidCurrentConfigurationLifecycleProcessor
	}
	if _, err := decoder.Token(); !errors.Is(err, io.EOF) {
		return CurrentConfigurationLifecycleIntent{}, ErrInvalidCurrentConfigurationLifecycleProcessor
	}
	if envelope.SchemaVersion != currentConfigurationLifecycleSchemaVersion {
		return CurrentConfigurationLifecycleIntent{}, ErrInvalidCurrentConfigurationLifecycleProcessor
	}
	before, ok := decodeCurrentConfigurationLifecycleSnapshot(envelope.Before)
	if !ok {
		return CurrentConfigurationLifecycleIntent{}, ErrInvalidCurrentConfigurationLifecycleProcessor
	}
	after, ok := decodeCurrentConfigurationLifecycleSnapshot(envelope.After)
	if !ok {
		return CurrentConfigurationLifecycleIntent{}, ErrInvalidCurrentConfigurationLifecycleProcessor
	}
	return CurrentConfigurationLifecycleIntent{
		ID:        eventID,
		Operation: envelope.Operation,
		ActorID:   envelope.ActorID,
		Before:    before,
		After:     after,
	}, nil
}

func encodeCurrentConfigurationLifecycleSnapshot(
	snapshot *CurrentConfigurationLifecycleSnapshot,
) *currentConfigurationLifecycleSnapshot {
	if snapshot == nil {
		return nil
	}
	return &currentConfigurationLifecycleSnapshot{
		ID:            snapshot.ID,
		UUID:          snapshot.UUID,
		ProjectID:     snapshot.ProjectID,
		EliteaTitle:   snapshot.EliteaTitle,
		Type:          snapshot.Type,
		Section:       snapshot.Section,
		Label:         snapshot.Label,
		Shared:        snapshot.Shared,
		StatusOK:      snapshot.StatusOK,
		Source:        snapshot.Source,
		AuthorID:      snapshot.AuthorID,
		DataAvailable: snapshot.Data != nil,
		Data:          snapshot.Data,
	}
}

func decodeCurrentConfigurationLifecycleSnapshot(
	snapshot *currentConfigurationLifecycleSnapshot,
) (*CurrentConfigurationLifecycleSnapshot, bool) {
	if snapshot == nil {
		return nil, true
	}
	if snapshot.DataAvailable != (snapshot.Data != nil) {
		return nil, false
	}
	return &CurrentConfigurationLifecycleSnapshot{
		ID:          snapshot.ID,
		UUID:        snapshot.UUID,
		ProjectID:   snapshot.ProjectID,
		EliteaTitle: snapshot.EliteaTitle,
		Type:        snapshot.Type,
		Section:     snapshot.Section,
		Label:       snapshot.Label,
		Shared:      snapshot.Shared,
		StatusOK:    snapshot.StatusOK,
		Source:      snapshot.Source,
		AuthorID:    snapshot.AuthorID,
		Data:        snapshot.Data,
	}, true
}
