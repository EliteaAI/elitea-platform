package centrysecrets

// Creating an empty vault, which is the one operation this package was missing.
//
// Every other entry point here opens or rewrites a vault that already exists.
// Until #371 the only code that could bring a project vault into being was the
// secrets HTTP handler, which mints a Fernet key inline on first write. So a
// project created by the provisioner had no vault at all, and the FIRST
// non-HTTP writer — project PgVector material — could only fail: RewriteUnwrapped
// needs a decryptable ciphertext, and an absent vault has none.
//
// The pair returned here is exactly the pair the two centry rows hold:
// `centry.secrets_key.data` and `centry.secrets_data.data`. The plaintext is
// the same `{"secrets": {}, "hidden_secrets": {}}` shape open() and rewrite()
// already require, so a vault created here is indistinguishable from one the
// Python implementation created.

import (
	"crypto/rand"
	"encoding/base64"
	"io"
	"time"
)

// emptyVaultPlaintext is the JSON an empty current vault holds. Both collections
// must be present and non-null: rewrite() rejects a vault whose `secrets` or
// `hidden_secrets` member is absent.
const emptyVaultPlaintext = `{"secrets":{},"hidden_secrets":{}}`

// CreateUnwrapped mints one project vault whose stored key is NOT encrypted by
// a master key. It returns the stored key in centry's on-disk form (the 44-byte
// URL-safe base64 encoding, which is what cryptography.Fernet.generate_key
// produces) and the encrypted empty vault.
//
// The caller owns both slices and must clear them after writing.
func CreateUnwrapped() (storedProjectKey, encryptedVault []byte, err error) {
	return createVault(nil, time.Now, rand.Reader)
}

// CreateWrapped is CreateUnwrapped for a deployment that configures a master
// key. The returned stored key is the project key encrypted under the master
// key, which is the form OpenWrapped and RewriteWrapped expect.
func CreateWrapped(masterKey []byte) (encryptedProjectKey, encryptedVault []byte, err error) {
	if len(masterKey) == 0 {
		return nil, nil, ErrInvalidMasterKey
	}
	return createVault(masterKey, time.Now, rand.Reader)
}

func createVault(
	masterKey []byte,
	now func() time.Time,
	entropy io.Reader,
) (storedProjectKey, encryptedVault []byte, err error) {
	if now == nil || entropy == nil {
		return nil, nil, ErrInvalidVault
	}

	var projectKey [fernetKeyBytes]byte
	if _, err := io.ReadFull(entropy, projectKey[:]); err != nil {
		return nil, nil, ErrInvalidProjectKey
	}
	defer clearKey(&projectKey)

	encoded := make([]byte, fernetEncodedKey)
	base64.URLEncoding.Encode(encoded, projectKey[:])

	encryptedVault, err = encryptFernet(projectKey, []byte(emptyVaultPlaintext), now(), entropy)
	if err != nil {
		clearBytes(encoded)
		return nil, nil, err
	}

	if len(masterKey) == 0 {
		return encoded, encryptedVault, nil
	}

	// The stored key is itself a Fernet token when a master key is configured.
	defer clearBytes(encoded)
	decodedMasterKey, ok := decodeFernetKey(masterKey)
	if !ok {
		clearBytes(encryptedVault)
		return nil, nil, ErrInvalidMasterKey
	}
	defer clearKey(&decodedMasterKey)

	wrapped, err := encryptFernet(decodedMasterKey, encoded, now(), entropy)
	if err != nil {
		clearBytes(encryptedVault)
		return nil, nil, ErrInvalidProjectKey
	}
	return wrapped, encryptedVault, nil
}
