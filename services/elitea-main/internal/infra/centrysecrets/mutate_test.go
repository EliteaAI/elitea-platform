package centrysecrets

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestRewriteUnwrappedRoundTripsCurrentVaultShape(t *testing.T) {
	updated, err := RewriteUnwrapped(
		[]byte(pythonProjectKey),
		[]byte(pythonVaultToken),
		[]Mutation{
			{Collection: RegularSecrets, Name: "normal", Value: "rotated-regular"},
			{Collection: HiddenSecrets, Name: "new_hidden", Value: "new-hidden-value"},
			{Collection: HiddenSecrets, Name: "hidden", Delete: true},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(updated, []byte(pythonVaultToken)) {
		t.Fatal("mutation returned the original token")
	}

	vault, err := OpenUnwrapped([]byte(pythonProjectKey), updated)
	if err != nil {
		t.Fatal(err)
	}
	assertLookup(t, vault, "normal", "rotated-regular", false)
	assertLookup(t, vault, "new_hidden", "new-hidden-value", true)
	if _, err := vault.Lookup("hidden"); !errors.Is(err, ErrSecretNotFound) {
		t.Fatalf("deleted hidden secret error=%v", err)
	}
	assertLookup(t, vault, "same", "regular-value", false)
}

func TestRewriteWrappedRoundTripsPythonFernetFixture(t *testing.T) {
	updated, err := RewriteWrapped(
		[]byte(pythonMasterKey),
		[]byte(pythonWrappedKey),
		[]byte(pythonVaultToken),
		[]Mutation{{Collection: RegularSecrets, Name: "default_llm_model_name", Value: "gpt-current"}},
	)
	if err != nil {
		t.Fatal(err)
	}
	vault, err := OpenWrapped([]byte(pythonMasterKey), []byte(pythonWrappedKey), updated)
	if err != nil {
		t.Fatal(err)
	}
	assertLookup(t, vault, "default_llm_model_name", "gpt-current", false)
	assertLookup(t, vault, "hidden", "hidden-canary", true)
}

func TestRewriteProducesCanonicalFernetHeaderWithInjectedClockAndEntropy(t *testing.T) {
	key, ok := decodeFernetKey([]byte(pythonProjectKey))
	if !ok {
		t.Fatal("fixture key is invalid")
	}
	issuedAt := time.Unix(1_700_000_000, 900_000_000)
	iv := []byte("0123456789abcdef")
	updated, err := rewrite(
		key,
		[]byte(pythonVaultToken),
		[]Mutation{{Collection: HiddenSecrets, Name: "deterministic", Value: "value"}},
		func() time.Time { return issuedAt },
		bytes.NewReader(iv),
	)
	clearKey(&key)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := base64.URLEncoding.DecodeString(string(updated))
	if err != nil {
		t.Fatal(err)
	}
	defer clearBytes(raw)
	if raw[0] != fernetVersion || binary.BigEndian.Uint64(raw[1:9]) != uint64(issuedAt.Unix()) || !bytes.Equal(raw[9:fernetHeaderBytes], iv) {
		t.Fatalf("fernet header version=%x timestamp=%d iv=%x", raw[0], binary.BigEndian.Uint64(raw[1:9]), raw[9:fernetHeaderBytes])
	}
	vault, err := OpenUnwrapped([]byte(pythonProjectKey), updated)
	if err != nil {
		t.Fatal(err)
	}
	assertLookup(t, vault, "deterministic", "value", true)
}

func TestRewriteRejectsInvalidMutationsAndCryptoInputsWithoutLeakingValues(t *testing.T) {
	secret := "sensitive-value"
	tests := []struct {
		name      string
		key       []byte
		vault     []byte
		mutations []Mutation
		want      error
	}{
		{name: "empty mutations", key: []byte(pythonProjectKey), vault: []byte(pythonVaultToken), want: ErrInvalidMutation},
		{name: "invalid collection", key: []byte(pythonProjectKey), vault: []byte(pythonVaultToken), mutations: []Mutation{{Collection: 9, Name: "valid", Value: secret}}, want: ErrInvalidMutation},
		{name: "invalid name", key: []byte(pythonProjectKey), vault: []byte(pythonVaultToken), mutations: []Mutation{{Collection: HiddenSecrets, Name: "bad-name", Value: secret}}, want: ErrInvalidMutation},
		{name: "duplicate", key: []byte(pythonProjectKey), vault: []byte(pythonVaultToken), mutations: []Mutation{{Collection: HiddenSecrets, Name: "same_name", Value: secret}, {Collection: HiddenSecrets, Name: "same_name", Value: "second"}}, want: ErrInvalidMutation},
		{name: "invalid project key", key: []byte("bad"), vault: []byte(pythonVaultToken), mutations: []Mutation{{Collection: HiddenSecrets, Name: "valid", Value: secret}}, want: ErrInvalidProjectKey},
		{name: "invalid vault", key: []byte(pythonProjectKey), vault: []byte("bad"), mutations: []Mutation{{Collection: HiddenSecrets, Name: "valid", Value: secret}}, want: ErrInvalidVault},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := RewriteUnwrapped(test.key, test.vault, test.mutations)
			if !errors.Is(err, test.want) {
				t.Fatalf("error=%v want=%v", err, test.want)
			}
			if err != nil && strings.Contains(err.Error(), secret) {
				t.Fatalf("error leaked secret value: %v", err)
			}
		})
	}

	_, err := RewriteWrapped(
		[]byte("bad-master"), []byte(pythonWrappedKey), []byte(pythonVaultToken),
		[]Mutation{{Collection: RegularSecrets, Name: "valid", Value: secret}},
	)
	if !errors.Is(err, ErrInvalidMasterKey) {
		t.Fatalf("master-key error=%v", err)
	}
}

func TestRewriteFailsClosedWhenEntropyFails(t *testing.T) {
	key, ok := decodeFernetKey([]byte(pythonProjectKey))
	if !ok {
		t.Fatal("fixture key is invalid")
	}
	_, err := rewrite(
		key,
		[]byte(pythonVaultToken),
		[]Mutation{{Collection: HiddenSecrets, Name: "valid", Value: "must-not-appear"}},
		time.Now,
		errReader{},
	)
	clearKey(&key)
	if !errors.Is(err, ErrInvalidVault) || strings.Contains(err.Error(), "must-not-appear") {
		t.Fatalf("entropy error=%v", err)
	}
}

type errReader struct{}

func (errReader) Read([]byte) (int, error) {
	return 0, errors.New("entropy unavailable")
}
