package centrysecrets

import (
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
