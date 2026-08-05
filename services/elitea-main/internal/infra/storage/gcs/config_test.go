package gcs

import (
	"strings"
	"testing"
)

func TestConfigRejectsEndpointAndCredentialsFileTogether(t *testing.T) {
	_, err := clientOptions(Config{
		Endpoint:        "http://localhost:4443/storage/v1/",
		CredentialsFile: "/tmp/creds.json",
	})
	if err == nil {
		t.Fatal("clientOptions with both Endpoint and CredentialsFile set = nil error, want an error")
	}
	msg := err.Error()
	if !strings.Contains(msg, "GCS_ENDPOINT") || !strings.Contains(msg, "GOOGLE_APPLICATION_CREDENTIALS") {
		t.Fatalf("clientOptions error %q does not name both GCS_ENDPOINT and GOOGLE_APPLICATION_CREDENTIALS", msg)
	}
}

func TestConfigWithOnlyCredentialsFileBuildsOneOption(t *testing.T) {
	opts, err := clientOptions(Config{CredentialsFile: "/tmp/creds.json"})
	if err != nil {
		t.Fatalf("clientOptions with only CredentialsFile set returned %v, want nil", err)
	}
	if len(opts) != 1 {
		t.Fatalf("clientOptions with only CredentialsFile set returned %d options, want 1", len(opts))
	}
}

func TestConfigWithOnlyEndpointBuildsUnauthenticatedOptions(t *testing.T) {
	opts, err := clientOptions(Config{Endpoint: "http://localhost:4443/storage/v1/"})
	if err != nil {
		t.Fatalf("clientOptions with only Endpoint set returned %v, want nil", err)
	}
	if len(opts) != 2 {
		t.Fatalf("clientOptions with only Endpoint set returned %d options, want 2 (WithEndpoint, WithoutAuthentication)", len(opts))
	}
}

func TestConfigWithNeitherEndpointNorCredentialsFileBuildsNoOptions(t *testing.T) {
	opts, err := clientOptions(Config{})
	if err != nil {
		t.Fatalf("clientOptions with neither set returned %v, want nil", err)
	}
	if len(opts) != 0 {
		t.Fatalf("clientOptions with neither set returned %d options, want 0 (default ADC)", len(opts))
	}
}
