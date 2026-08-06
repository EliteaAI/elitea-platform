package runtimecomposition

import (
	"errors"
	"strings"
	"testing"
)

func TestPinnedCurrentSDKConfigurationCatalogMatchesWorkerRegistry(t *testing.T) {
	catalog, err := LoadPinnedCurrentSDKConfigurationCatalog()
	if err != nil {
		t.Fatal(err)
	}
	const revision = "6155d20acb4a3b00a6085212a75258cc1b3c695a"
	if catalog.SDKRevision() != revision || catalog.CatalogRevision() != revision ||
		catalog.EntryCount() != 32 {
		t.Fatalf(
			"sdk=%q catalog=%q entries=%d",
			catalog.SDKRevision(),
			catalog.CatalogRevision(),
			catalog.EntryCount(),
		)
	}
	if got := catalog.CatalogDigest(); got != mustCurrentSDKConfigurationDigest(t, "4a96e3ab8e3842ebf2645a851aeb12e3e2343f28e7d024c1a2960eb4ec254351") {
		t.Fatalf("catalog digest=%x", got)
	}

	openAPI, found := catalog.Binding("openapi")
	if !found || openAPI.SchemaID != "elitea.configuration.openapi" ||
		openAPI.SchemaRevision != revision || !openAPI.ValidationSupported ||
		!openAPI.ConnectionCheckSupported {
		t.Fatalf("openapi binding=%+v found=%t", openAPI, found)
	}
	if openAPI.SchemaDigest != mustCurrentSDKConfigurationDigest(t, "1c43c41a5304c6f73c68deebd37ba70f8c2266a59dfd4f9d4fa20b819e7ab3f1") {
		t.Fatalf("openapi schema digest=%x", openAPI.SchemaDigest)
	}
	aha, found := catalog.Binding("aha")
	if !found || aha.Section != "credentials" || !aha.ValidationSupported ||
		!aha.ConnectionCheckSupported {
		t.Fatalf("aha binding=%+v found=%t", aha, found)
	}
	if _, found := catalog.Binding("embedding"); found {
		t.Fatal("unregistered SDK embedding model was admitted as a generic configuration")
	}
}

func TestCurrentSDKConfigurationCatalogRejectsPartialOrDriftedDocuments(t *testing.T) {
	revision := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	valid := `{"schema_version":"elitea.worker-sdk-configuration-catalog.v1","sdk_revision":"` + revision + `","catalog_revision":"` + revision + `","catalog_digest":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","complete":true,"entry_count":1,"entries":[{"configuration_type":"openapi","section":"credentials","schema_id":"elitea.configuration.openapi","schema_revision":"` + revision + `","schema_digest":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","validation_supported":true,"connection_check_supported":true}]}`
	if _, err := LoadCurrentSDKConfigurationCatalog([]byte(valid)); err != nil {
		t.Fatal(err)
	}
	tests := []string{
		strings.Replace(valid, `"complete":true`, `"complete":false`, 1),
		strings.Replace(valid, `"entry_count":1`, `"entry_count":2`, 1),
		strings.Replace(valid, `"catalog_revision":"`+revision+`"`, `"catalog_revision":"other"`, 1),
		strings.Replace(valid, `"schema_id":"elitea.configuration.openapi"`, `"schema_id":"elitea.configuration.github"`, 1),
		strings.Replace(valid, `"schema_revision":"`+revision+`"`, `"schema_revision":"other"`, 1),
		strings.Replace(valid, `sha256:bbbb`, `sha256:BBBB`, 1),
		strings.Replace(valid, `"complete":true`, `"complete":true,"unknown":1`, 1),
		valid + `{}`,
	}
	for index, data := range tests {
		if _, err := LoadCurrentSDKConfigurationCatalog([]byte(data)); !errors.Is(err, ErrCurrentSDKConfigurationCatalogInvalid) {
			t.Fatalf("case %d error=%v", index, err)
		}
	}
	if _, err := LoadCurrentSDKConfigurationCatalog(
		[]byte(strings.Repeat("x", maxCurrentSDKConfigurationCatalogBytes+1)),
	); !errors.Is(err, ErrCurrentSDKConfigurationCatalogInvalid) {
		t.Fatalf("oversized error=%v", err)
	}
}

func mustCurrentSDKConfigurationDigest(t *testing.T, value string) [32]byte {
	t.Helper()
	digest, ok := parseCurrentSDKConfigurationDigest("sha256:" + value)
	if !ok {
		t.Fatalf("invalid test digest %q", value)
	}
	return digest
}
