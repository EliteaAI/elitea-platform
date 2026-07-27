package centrysecrets

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

// These deterministic fixtures were generated with cryptography 48.0.0 using
// Fernet._encrypt_from_parts solely to fix the timestamp and IV. Production
// Centry uses the same public Fernet encrypt/decrypt wire representation.
const (
	pythonMasterKey  = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8="
	pythonProjectKey = "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8="
	pythonWrappedKey = "gAAAAABlU_EAoKGio6SlpqeoqaqrrK2uryHMXcX6u3HizkFeKnBIPXqOzdaW4oCAofma6bzJk8y2Ei0rbhRDFYgh-0veP4OgLAC1Vi8Jba2ulGhC4bQrzwA4rrjMrzA3m8X5wInwskE6"
	pythonVaultToken = "gAAAAABlU_EBsLGys7S1tre4ubq7vL2-vx1XMkCj-NAPVrz2qJjob7g8g2X5uZRKHkqRYf3PrTLUC8Q1IHnCMja09Xr6VixBNDJNqcJhTDidsE3D9XlcDpLfJ6e5zNz6DsTP67crLz-PvCJO0qwoNSpc2vwiLlTkf2xnyvlVOAMXlrmueSNrVxUoOGRzpK_fci7UQqhXtn2DDrjEgHLzW77baCUbY6nqH4w48HOBwzsCN7Y6dpkZkns7IK5pFKZs4WwYxYbAU6Q0"

	pythonMalformedJSONToken = "gAAAAABlU_EKEBAQEBAQEBAQEBAQEBAQEJs86aA2CRRTvHUux5D4v45CP0LdxHR7LQygOHM2APdLb5-0LMeW-5-gzuPcj7n99FlGfejINI41LWFYWIdmx-VfvDlV8G16WYKhKVRvhJwB"
	pythonNonStringToken     = "gAAAAABlU_ELEREREREREREREREREREREQiWh9JLAuayl1SXCTelvtxml03S7GS3nd_bFC0G8JbKETSfxqF2X8tYC63ehXKm6tGiVAJxzf_SKlkgjJ3WzM0Zgmpj6cGs1Z43uQFq78ld"
	pythonUnknownFieldToken  = "gAAAAABlU_EMEhISEhISEhISEhISEhISEmjwYw1C56_Jk72E_mvdDPzp61pbKmUmHyWvYt1mFSh6uMSbo3ScJGBe88umD1cD5bDd8RLoiiUoLQuPhPdO3NcUicybqagydYw0HFoYThOH36sIgTzSrMXMhZ2IfkoPEA=="
	pythonMissingMapToken    = "gAAAAABlU_ENExMTExMTExMTExMTExMTE6c7vt0AXXoq6EtDju44dZIMtbxlsf44W1KVNOFvJ6Z9oMt0M1pfHADNROchwXXD2A=="
	pythonNullMapToken       = "gAAAAABlU_EOFBQUFBQUFBQUFBQUFBQUFBQYE32wOgWVgBmus-qQxdUWUQnkn1RHDZ-7_OIEcLyKFTr2Ci-P1RXBSWkvusv2TfUOQQwvUmgmo3KRF-SCpNwkdshdGHxaPZTDbJOY8Foa"
)

func TestPythonFernetGoldenVaultUnwrapped(t *testing.T) {
	vault, err := OpenUnwrapped([]byte(pythonProjectKey), []byte(pythonVaultToken))
	if err != nil {
		t.Fatal(err)
	}

	assertLookup(t, vault, "normal", "normal-canary", false)
	assertLookup(t, vault, "hidden", "hidden-canary", true)
	// EngineBase applies hidden first and regular second, and the current GET
	// endpoint also checks regular first.
	assertLookup(t, vault, "same", "regular-value", false)

	if _, err := vault.Lookup("NORMAL"); !errors.Is(err, ErrSecretNotFound) {
		t.Fatalf("case-normalized lookup error = %v, want ErrSecretNotFound", err)
	}
	if _, err := vault.Lookup("missing"); !errors.Is(err, ErrSecretNotFound) {
		t.Fatalf("missing lookup error = %v, want ErrSecretNotFound", err)
	}
}

func TestPythonFernetGoldenVaultMasterWrapped(t *testing.T) {
	vault, err := OpenWrapped(
		[]byte(pythonMasterKey),
		[]byte(pythonWrappedKey),
		[]byte(pythonVaultToken),
	)
	if err != nil {
		t.Fatal(err)
	}
	assertLookup(t, vault, "normal", "normal-canary", false)
	assertLookup(t, vault, "hidden", "hidden-canary", true)
}

func TestOpenRejectsWrongModeMalformedAndTamperedMaterial(t *testing.T) {
	tests := []struct {
		name string
		open func() error
		want error
	}{
		{
			name: "malformed unwrapped project key",
			open: func() error {
				_, err := OpenUnwrapped([]byte("PROJECT_KEY_CANARY"), []byte(pythonVaultToken))
				return err
			},
			want: ErrInvalidProjectKey,
		},
		{
			name: "wrapped key is not accepted as unwrapped",
			open: func() error {
				_, err := OpenUnwrapped([]byte(pythonWrappedKey), []byte(pythonVaultToken))
				return err
			},
			want: ErrInvalidProjectKey,
		},
		{
			name: "malformed master key",
			open: func() error {
				_, err := OpenWrapped([]byte("MASTER_KEY_CANARY"), []byte(pythonWrappedKey), []byte(pythonVaultToken))
				return err
			},
			want: ErrInvalidMasterKey,
		},
		{
			name: "wrong valid master key",
			open: func() error {
				_, err := OpenWrapped([]byte(pythonProjectKey), []byte(pythonWrappedKey), []byte(pythonVaultToken))
				return err
			},
			want: ErrInvalidProjectKey,
		},
		{
			name: "unwrapped key is not accepted as wrapped payload",
			open: func() error {
				_, err := OpenWrapped([]byte(pythonMasterKey), []byte(pythonProjectKey), []byte(pythonVaultToken))
				return err
			},
			want: ErrInvalidProjectKey,
		},
		{
			name: "tampered wrapped project key",
			open: func() error {
				_, err := OpenWrapped([]byte(pythonMasterKey), tamper(pythonWrappedKey), []byte(pythonVaultToken))
				return err
			},
			want: ErrInvalidProjectKey,
		},
		{
			name: "malformed vault token",
			open: func() error {
				_, err := OpenUnwrapped([]byte(pythonProjectKey), []byte("CIPHERTEXT_CANARY"))
				return err
			},
			want: ErrInvalidVault,
		},
		{
			name: "tampered vault token",
			open: func() error {
				_, err := OpenUnwrapped([]byte(pythonProjectKey), tamper(pythonVaultToken))
				return err
			},
			want: ErrInvalidVault,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := test.open()
			if !errors.Is(err, test.want) {
				t.Fatalf("error = %v, want %v", err, test.want)
			}
			assertNoMaterialInError(t, err,
				"PROJECT_KEY_CANARY",
				"MASTER_KEY_CANARY",
				"CIPHERTEXT_CANARY",
				pythonMasterKey,
				pythonProjectKey,
				pythonWrappedKey,
				pythonVaultToken,
			)
		})
	}
}

func TestOpenRejectsMalformedVaultJSONShapeWithoutLeakingMaterial(t *testing.T) {
	tests := []struct {
		name  string
		token string
	}{
		{name: "malformed JSON", token: pythonMalformedJSONToken},
		{name: "unknown top-level field", token: pythonUnknownFieldToken},
		{name: "missing hidden map", token: pythonMissingMapToken},
		{name: "null regular map", token: pythonNullMapToken},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := OpenUnwrapped([]byte(pythonProjectKey), []byte(test.token))
			if !errors.Is(err, ErrInvalidVault) {
				t.Fatalf("error = %v, want ErrInvalidVault", err)
			}
			assertNoMaterialInError(t, err, "PLAINTEXT_CANARY", pythonProjectKey, test.token)
		})
	}
}

func TestLookupRejectsNonStringValueWithoutLeakingMaterial(t *testing.T) {
	vault, err := OpenUnwrapped([]byte(pythonProjectKey), []byte(pythonNonStringToken))
	if err != nil {
		t.Fatal(err)
	}
	_, err = vault.Lookup("canary")
	if !errors.Is(err, ErrInvalidSecret) {
		t.Fatalf("error = %v, want ErrInvalidSecret", err)
	}
	assertNoMaterialInError(t, err, "canary", "123", pythonProjectKey, pythonNonStringToken)
}

func TestNilVaultFailsClosed(t *testing.T) {
	var vault *Vault
	if _, err := vault.Lookup("canary"); !errors.Is(err, ErrInvalidVault) {
		t.Fatalf("error = %v, want ErrInvalidVault", err)
	}
	if _, err := vault.LookupRegular("canary"); !errors.Is(err, ErrInvalidVault) {
		t.Fatalf("regular lookup error = %v, want ErrInvalidVault", err)
	}
	if _, err := vault.LookupRegularInteger("canary"); !errors.Is(err, ErrInvalidVault) {
		t.Fatalf("regular integer lookup error = %v, want ErrInvalidVault", err)
	}
	if _, err := vault.LookupPythonInteger("canary"); !errors.Is(err, ErrInvalidVault) {
		t.Fatalf("python integer lookup error = %v, want ErrInvalidVault", err)
	}
	if _, err := vault.LookupRegularPythonInteger("canary"); !errors.Is(err, ErrInvalidVault) {
		t.Fatalf("regular python integer lookup error = %v, want ErrInvalidVault", err)
	}
}

func TestLookupRegularDoesNotExposeHiddenSecret(t *testing.T) {
	vault, err := OpenUnwrapped([]byte(pythonProjectKey), []byte(pythonVaultToken))
	if err != nil {
		t.Fatal(err)
	}
	assertLookup(t, vault, "normal", "normal-canary", false)
	regular, err := vault.LookupRegular("normal")
	if err != nil || regular.Value != "normal-canary" || regular.Hidden {
		t.Fatalf("regular lookup = %+v, %v", regular, err)
	}
	if _, err := vault.LookupRegular("hidden"); !errors.Is(err, ErrSecretNotFound) {
		t.Fatalf("hidden regular lookup error = %v, want ErrSecretNotFound", err)
	}
}

func TestLookupProjectIDAcceptsCurrentStringAndIntegerEncodings(t *testing.T) {
	vault, ok := parseVault([]byte(`{
		"secrets": {
			"numeric": 42,
			"string": "0042",
			"empty": "",
			"regular_wins": 7
		},
		"hidden_secrets": {
			"hidden": 9,
			"regular_wins": 8
		}
	}`))
	if !ok {
		t.Fatal("current numeric/string vault shape was rejected")
	}

	tests := []struct {
		name   string
		value  string
		hidden bool
	}{
		{name: "numeric", value: "42"},
		{name: "string", value: "42"},
		{name: "empty", value: ""},
		{name: "hidden", value: "9", hidden: true},
		{name: "regular_wins", value: "7"},
	}
	for _, test := range tests {
		secret, err := vault.LookupProjectID(test.name)
		if err != nil || secret.Value != test.value || secret.Hidden != test.hidden {
			t.Fatalf("lookup %q = %+v, %v", test.name, secret, err)
		}
	}
	if _, err := vault.LookupRegularProjectID("hidden"); !errors.Is(err, ErrSecretNotFound) {
		t.Fatalf("regular hidden lookup error=%v", err)
	}
	if _, err := vault.LookupProjectID("missing"); !errors.Is(err, ErrSecretNotFound) {
		t.Fatalf("missing lookup error=%v", err)
	}
}

func TestLookupRegularIntegerAcceptsCurrentPythonIntShapes(t *testing.T) {
	vault := &Vault{
		regular: map[string]json.RawMessage{
			"number":         json.RawMessage(`45`),
			"string":         json.RawMessage(`" 0045 "`),
			"zero":           json.RawMessage(`0`),
			"negative":       json.RawMessage(`-1`),
			"integral_float": json.RawMessage(`45.0`),
			"invalid":        json.RawMessage(`45.5`),
		},
		hidden: map[string]json.RawMessage{"hidden": json.RawMessage(`12`)},
	}
	for name, want := range map[string]string{
		"number": "45", "string": "45", "zero": "0", "negative": "-1", "integral_float": "45",
	} {
		secret, err := vault.LookupRegularInteger(name)
		if err != nil || secret.Value != want || secret.Hidden {
			t.Fatalf("lookup %q = %+v, %v; want %q", name, secret, err, want)
		}
	}
	if _, err := vault.LookupRegularInteger("invalid"); !errors.Is(err, ErrInvalidSecret) {
		t.Fatalf("invalid integer error=%v", err)
	}
	if _, err := vault.LookupRegularInteger("hidden"); !errors.Is(err, ErrSecretNotFound) {
		t.Fatalf("hidden integer error=%v", err)
	}
}

func TestLookupPythonIntegerMatchesCurrentChatConfigIntContract(t *testing.T) {
	vault := &Vault{
		regular: map[string]json.RawMessage{
			"bool_true":          json.RawMessage(`true`),
			"bool_false":         json.RawMessage(`false`),
			"integer":            json.RawMessage(`123456789012345678901234567890`),
			"fraction":           json.RawMessage(`45.9`),
			"negative":           json.RawMessage(`-45.9`),
			"exponent":           json.RawMessage(`1e20`),
			"binary64_exponent":  json.RawMessage(`1e100`),
			"binary64_underflow": json.RawMessage(`1e-400`),
			"string":             json.RawMessage(`" +1_234 "`),
			"unicode_digits":     json.RawMessage(`"١٢٣"`),
			"regular_wins":       json.RawMessage(`7`),
			"string_float":       json.RawMessage(`"45.0"`),
			"null":               json.RawMessage(`null`),
			"object":             json.RawMessage(`{"value":45}`),
			"invalid_underscore": json.RawMessage(`"1__2"`),
		},
		hidden: map[string]json.RawMessage{
			"hidden":       json.RawMessage(`88.7`),
			"regular_wins": json.RawMessage(`9`),
		},
	}
	for name, want := range map[string]string{
		"bool_true":          "1",
		"bool_false":         "0",
		"integer":            "123456789012345678901234567890",
		"fraction":           "45",
		"negative":           "-45",
		"exponent":           "100000000000000000000",
		"binary64_exponent":  "10000000000000000159028911097599180468360808563945281389781327557747838772170381060813469985856815104",
		"binary64_underflow": "0",
		"string":             "1234",
		"unicode_digits":     "123",
		"hidden":             "88",
		"regular_wins":       "7",
	} {
		secret, err := vault.LookupPythonInteger(name)
		if err != nil || secret.Value != want {
			t.Fatalf("lookup %q = %+v, %v; want %q", name, secret, err, want)
		}
	}
	for _, name := range []string{"string_float", "null", "object", "invalid_underscore"} {
		if _, err := vault.LookupPythonInteger(name); !errors.Is(err, ErrInvalidSecret) {
			t.Fatalf("invalid lookup %q error=%v", name, err)
		}
	}
	if _, err := vault.LookupRegularPythonInteger("hidden"); !errors.Is(err, ErrSecretNotFound) {
		t.Fatalf("admin-style regular lookup exposed hidden secret: %v", err)
	}
}

func TestLookupProjectIDRejectsInvalidShapesAndRangeWithoutLeakingValues(t *testing.T) {
	invalid := map[string]json.RawMessage{
		"bool-canary":      json.RawMessage(`true`),
		"float-canary":     json.RawMessage(`1.0`),
		"exponent-canary":  json.RawMessage(`1e2`),
		"negative-canary":  json.RawMessage(`-1`),
		"zero-canary":      json.RawMessage(`0`),
		"overflow-canary":  json.RawMessage(`2147483648`),
		"object-canary":    json.RawMessage(`{"value":1}`),
		"array-canary":     json.RawMessage(`[1]`),
		"null-canary":      json.RawMessage(`null`),
		"string-float":     json.RawMessage(`"1.0"`),
		"string-exponent":  json.RawMessage(`"1e2"`),
		"string-negative":  json.RawMessage(`"-1"`),
		"oversized-string": json.RawMessage(`"00000000001"`),
	}
	vault := &Vault{regular: invalid, hidden: map[string]json.RawMessage{}}
	for name := range invalid {
		_, err := vault.LookupProjectID(name)
		if !errors.Is(err, ErrInvalidSecret) {
			t.Fatalf("lookup %q error=%v", name, err)
		}
		assertNoMaterialInError(t, err, name, string(invalid[name]))
	}

	var nilVault *Vault
	if _, err := nilVault.LookupProjectID("canary"); !errors.Is(err, ErrInvalidVault) {
		t.Fatalf("nil lookup error=%v", err)
	}
	if _, err := nilVault.LookupRegularProjectID("canary"); !errors.Is(err, ErrInvalidVault) {
		t.Fatalf("nil regular lookup error=%v", err)
	}
}

func assertLookup(t *testing.T, vault *Vault, name, value string, hidden bool) {
	t.Helper()
	secret, err := vault.Lookup(name)
	if err != nil {
		t.Fatal(err)
	}
	if secret.Value != value || secret.Hidden != hidden {
		t.Fatalf("lookup %q = %+v, want value %q hidden %t", name, secret, value, hidden)
	}
}

func assertNoMaterialInError(t *testing.T, err error, material ...string) {
	t.Helper()
	if err == nil {
		t.Fatal("expected error")
	}
	for _, value := range material {
		if value != "" && strings.Contains(err.Error(), value) {
			t.Fatalf("error contains protected material %q: %v", value, err)
		}
	}
}

func tamper(value string) []byte {
	tampered := []byte(value)
	index := len(tampered) / 2
	if tampered[index] == 'A' {
		tampered[index] = 'B'
	} else {
		tampered[index] = 'A'
	}
	return tampered
}
