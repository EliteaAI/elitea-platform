package main

import "testing"

func TestConfiguredHTTPAddressDefaultsAndValidatesOverride(t *testing.T) {
	lookup := func(string) (string, bool) { return "", false }
	address, err := configuredHTTPAddress(lookup)
	if err != nil || address != defaultHTTPAddress {
		t.Fatalf("default address = %q, err = %v", address, err)
	}

	lookup = func(key string) (string, bool) {
		if key == "ELITEA_HTTP_ADDRESS" {
			return "127.0.0.1:18080", true
		}
		return "", false
	}
	address, err = configuredHTTPAddress(lookup)
	if err != nil || address != "127.0.0.1:18080" {
		t.Fatalf("override address = %q, err = %v", address, err)
	}

	for _, invalid := range []string{"localhost", ":0", ":65536", ":08080", ":abc", ":8080\nspoof"} {
		lookup = func(string) (string, bool) { return invalid, true }
		if _, err := configuredHTTPAddress(lookup); err == nil {
			t.Fatalf("invalid HTTP address %q was accepted", invalid)
		}
	}
}

func TestHealthcheckURLUsesConfiguredListenerPort(t *testing.T) {
	lookup := func(string) (string, bool) { return ":18080", true }
	endpoint, err := healthcheckURL(lookup)
	if err != nil {
		t.Fatal(err)
	}
	if endpoint != "http://localhost:18080/healthz" {
		t.Fatalf("healthcheck URL = %q", endpoint)
	}
}
