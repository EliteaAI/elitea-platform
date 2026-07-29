package runtimecomposition

import (
	"bytes"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"strings"
)

const (
	currentSDKConfigurationCatalogVersion  = "elitea.worker-sdk-configuration-catalog.v1"
	maxCurrentSDKConfigurationCatalogBytes = 256 << 10
	maxCurrentSDKConfigurationEntries      = 256
)

var ErrCurrentSDKConfigurationCatalogInvalid = errors.New("current SDK configuration catalog is invalid")

//go:embed current_sdk_configuration_catalog_snapshot.json
var pinnedCurrentSDKConfigurationCatalogJSON []byte

type currentSDKConfigurationCatalogDocument struct {
	SchemaVersion   string                                    `json:"schema_version"`
	SDKRevision     string                                    `json:"sdk_revision"`
	CatalogRevision string                                    `json:"catalog_revision"`
	CatalogDigest   string                                    `json:"catalog_digest"`
	Complete        bool                                      `json:"complete"`
	EntryCount      int                                       `json:"entry_count"`
	Entries         []currentSDKConfigurationCatalogJSONEntry `json:"entries"`
}

type currentSDKConfigurationCatalogJSONEntry struct {
	ConfigurationType        string `json:"configuration_type"`
	Section                  string `json:"section"`
	SchemaID                 string `json:"schema_id"`
	SchemaRevision           string `json:"schema_revision"`
	SchemaDigest             string `json:"schema_digest"`
	ValidationSupported      bool   `json:"validation_supported"`
	ConnectionCheckSupported bool   `json:"connection_check_supported"`
}

// CurrentSDKConfigurationBinding is the exact worker admission identity for
// one generic SDK-owned configuration type.
type CurrentSDKConfigurationBinding struct {
	ConfigurationType        string
	Section                  string
	SchemaID                 string
	SchemaRevision           string
	SchemaDigest             [32]byte
	ValidationSupported      bool
	ConnectionCheckSupported bool
}

// CurrentSDKConfigurationCatalog is an immutable projection generated from
// the same SDK registry and canonical schemas as ConfigurationRegistryShadow.
type CurrentSDKConfigurationCatalog struct {
	sdkRevision     string
	catalogRevision string
	catalogDigest   [32]byte
	entries         map[string]CurrentSDKConfigurationBinding
}

func LoadPinnedCurrentSDKConfigurationCatalog() (*CurrentSDKConfigurationCatalog, error) {
	return LoadCurrentSDKConfigurationCatalog(pinnedCurrentSDKConfigurationCatalogJSON)
}

func LoadCurrentSDKConfigurationCatalog(data []byte) (*CurrentSDKConfigurationCatalog, error) {
	if len(data) == 0 || len(data) > maxCurrentSDKConfigurationCatalogBytes {
		return nil, ErrCurrentSDKConfigurationCatalogInvalid
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var document currentSDKConfigurationCatalogDocument
	if err := decoder.Decode(&document); err != nil {
		return nil, ErrCurrentSDKConfigurationCatalogInvalid
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return nil, ErrCurrentSDKConfigurationCatalogInvalid
	}
	if document.SchemaVersion != currentSDKConfigurationCatalogVersion || !document.Complete ||
		!validCurrentSDKRevision(document.SDKRevision) || document.CatalogRevision != document.SDKRevision ||
		document.EntryCount != len(document.Entries) || document.EntryCount == 0 ||
		document.EntryCount > maxCurrentSDKConfigurationEntries {
		return nil, ErrCurrentSDKConfigurationCatalogInvalid
	}
	catalogDigest, ok := parseCurrentSDKConfigurationDigest(document.CatalogDigest)
	if !ok {
		return nil, ErrCurrentSDKConfigurationCatalogInvalid
	}

	entries := make(map[string]CurrentSDKConfigurationBinding, len(document.Entries))
	previousType := ""
	for index := range document.Entries {
		entry := document.Entries[index]
		if !validCurrentToolkitSchemaIdentifier(entry.ConfigurationType) ||
			!validCurrentToolkitSchemaIdentifier(entry.Section) ||
			(index > 0 && entry.ConfigurationType <= previousType) ||
			entry.SchemaID != "elitea.configuration."+entry.ConfigurationType ||
			entry.SchemaRevision != document.SDKRevision {
			return nil, ErrCurrentSDKConfigurationCatalogInvalid
		}
		previousType = entry.ConfigurationType
		schemaDigest, valid := parseCurrentSDKConfigurationDigest(entry.SchemaDigest)
		if !valid {
			return nil, ErrCurrentSDKConfigurationCatalogInvalid
		}
		entries[entry.ConfigurationType] = CurrentSDKConfigurationBinding{
			ConfigurationType:        entry.ConfigurationType,
			Section:                  entry.Section,
			SchemaID:                 entry.SchemaID,
			SchemaRevision:           entry.SchemaRevision,
			SchemaDigest:             schemaDigest,
			ValidationSupported:      entry.ValidationSupported,
			ConnectionCheckSupported: entry.ConnectionCheckSupported,
		}
	}

	return &CurrentSDKConfigurationCatalog{
		sdkRevision:     document.SDKRevision,
		catalogRevision: document.CatalogRevision,
		catalogDigest:   catalogDigest,
		entries:         entries,
	}, nil
}

func (c *CurrentSDKConfigurationCatalog) SDKRevision() string {
	if c == nil {
		return ""
	}
	return c.sdkRevision
}

func (c *CurrentSDKConfigurationCatalog) CatalogRevision() string {
	if c == nil {
		return ""
	}
	return c.catalogRevision
}

func (c *CurrentSDKConfigurationCatalog) CatalogDigest() [32]byte {
	if c == nil {
		return [32]byte{}
	}
	return c.catalogDigest
}

func (c *CurrentSDKConfigurationCatalog) EntryCount() int {
	if c == nil {
		return 0
	}
	return len(c.entries)
}

func (c *CurrentSDKConfigurationCatalog) Binding(
	configurationType string,
) (CurrentSDKConfigurationBinding, bool) {
	if c == nil {
		return CurrentSDKConfigurationBinding{}, false
	}
	binding, found := c.entries[configurationType]
	return binding, found
}

func parseCurrentSDKConfigurationDigest(value string) ([32]byte, bool) {
	const prefix = "sha256:"
	if !strings.HasPrefix(value, prefix) || len(value) != len(prefix)+64 {
		return [32]byte{}, false
	}
	encoded := value[len(prefix):]
	if encoded != strings.ToLower(encoded) {
		return [32]byte{}, false
	}
	decoded, err := hex.DecodeString(encoded)
	if err != nil || len(decoded) != 32 {
		return [32]byte{}, false
	}
	var digest [32]byte
	copy(digest[:], decoded)
	return digest, true
}

func validCurrentSDKRevision(value string) bool {
	if len(value) != 40 || value != strings.ToLower(value) {
		return false
	}
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == 20
}
