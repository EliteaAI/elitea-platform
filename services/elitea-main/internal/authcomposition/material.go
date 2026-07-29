package authcomposition

import (
	"bytes"
	"crypto/x509"
	"errors"
	"fmt"
	"unicode/utf8"

	browserapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/browserauth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/security/securefile"
)

const (
	maxRedisPasswordFileBytes = int64(514)
	maxRedisPasswordBytes     = 512
	minAttemptKeyBytes        = 32
	maxAttemptKeyBytes        = 64
	maxPATSigningKeyBytes     = int64(64 << 10)
	maxRedisCAFileBytes       = int64(1 << 20)
)

var ErrInvalidMaterial = errors.New("invalid authentication composition material")

// materializedFiles is a short-lived startup value. Call destroy immediately
// after constructors have snapshotted the required material. FormProvider
// retains only keyed password digests; raw Form JSON is never retained here.
type materializedFiles struct {
	redisPassword []byte
	redisRoots    *x509.CertPool
	attemptKey    []byte
	patSigningKey []byte
	formProvider  *browserapp.FormProvider
}

type materialReference struct {
	purpose  string
	snapshot securefile.Snapshot
}

func materialize(config Config) (*materializedFiles, error) {
	if err := config.Validate(); err != nil {
		return nil, fmt.Errorf("%w: configuration", ErrInvalidMaterial)
	}

	references := make([]materialReference, 0, 5)
	defer func() {
		for index := range references {
			clear(references[index].snapshot.Contents)
		}
	}()

	read := func(purpose string, path string, maxBytes int64, permissions securefile.Permissions) (securefile.Snapshot, error) {
		snapshot, err := securefile.ReadSnapshot(path, maxBytes, permissions)
		if err != nil {
			// Do not copy os.PathError paths into a potentially shared startup log.
			return securefile.Snapshot{}, fmt.Errorf("%w: load %s file", ErrInvalidMaterial, purpose)
		}
		references = append(references, materialReference{purpose: purpose, snapshot: snapshot})
		return snapshot, nil
	}

	redisPasswordFile, err := read(
		"Redis password",
		config.Redis.PasswordFile,
		maxRedisPasswordFileBytes,
		securefile.PrivateMaterial,
	)
	if err != nil {
		return nil, err
	}
	redisCAFile, err := read(
		"Redis CA",
		config.Redis.CAFile,
		maxRedisCAFileBytes,
		securefile.PublicMaterial,
	)
	if err != nil {
		return nil, err
	}
	attemptKeyFile, err := read(
		"browser-attempt key",
		config.Redis.AttemptKeyFile,
		maxAttemptKeyBytes,
		securefile.PrivateMaterial,
	)
	if err != nil {
		return nil, err
	}
	patKeyFile, err := read(
		"PAT signing key",
		config.Credentials.PATSigningKeyFile,
		maxPATSigningKeyBytes,
		securefile.PrivateMaterial,
	)
	if err != nil {
		return nil, err
	}
	formUsersFile, err := read(
		"Form users JSON",
		config.Provider.Form.UsersJSONFile,
		browserapp.MaxFormConfigurationBytes,
		securefile.PrivateMaterial,
	)
	if err != nil {
		return nil, err
	}

	if err := validateMaterialReferences(references); err != nil {
		return nil, err
	}

	redisPassword, ok := normalizeRedisPassword(redisPasswordFile.Contents)
	if !ok {
		return nil, fmt.Errorf("%w: Redis password", ErrInvalidMaterial)
	}
	if len(attemptKeyFile.Contents) < minAttemptKeyBytes || len(attemptKeyFile.Contents) > maxAttemptKeyBytes {
		return nil, fmt.Errorf("%w: browser-attempt key", ErrInvalidMaterial)
	}
	// Existing Python-issued HS512 PATs require these exact UTF-8 bytes. In
	// particular, do not TrimSpace or consume a terminal newline here.
	if !utf8.Valid(patKeyFile.Contents) || bytes.IndexByte(patKeyFile.Contents, 0) >= 0 {
		return nil, fmt.Errorf("%w: PAT signing key", ErrInvalidMaterial)
	}
	if !separateEffectiveSecrets(redisPassword, attemptKeyFile.Contents, patKeyFile.Contents) {
		return nil, fmt.Errorf("%w: effective secret purpose separation", ErrInvalidMaterial)
	}

	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(redisCAFile.Contents) {
		return nil, fmt.Errorf("%w: Redis CA", ErrInvalidMaterial)
	}
	provider, err := browserapp.NewFormProvider(formUsersFile.Contents)
	if err != nil {
		return nil, fmt.Errorf("%w: Form users JSON", ErrInvalidMaterial)
	}

	return &materializedFiles{
		redisPassword: append([]byte(nil), redisPassword...),
		redisRoots:    roots,
		attemptKey:    append([]byte(nil), attemptKeyFile.Contents...),
		patSigningKey: append([]byte(nil), patKeyFile.Contents...),
		formProvider:  provider,
	}, nil
}

func validateMaterialReferences(references []materialReference) error {
	for left := range references {
		for right := left + 1; right < len(references); right++ {
			if references[left].snapshot.SameFile(references[right].snapshot) {
				return fmt.Errorf(
					"%w: %s and %s reference one file",
					ErrInvalidMaterial,
					references[left].purpose,
					references[right].purpose,
				)
			}
			if bytes.Equal(references[left].snapshot.Contents, references[right].snapshot.Contents) {
				return fmt.Errorf(
					"%w: %s and %s reuse one value",
					ErrInvalidMaterial,
					references[left].purpose,
					references[right].purpose,
				)
			}
		}
	}
	return nil
}

func separateEffectiveSecrets(values ...[]byte) bool {
	for left := range values {
		for right := left + 1; right < len(values); right++ {
			if bytes.Equal(values[left], values[right]) {
				return false
			}
		}
	}
	return true
}

func normalizeRedisPassword(raw []byte) ([]byte, bool) {
	value := raw
	if len(value) > 0 && value[len(value)-1] == '\n' {
		value = value[:len(value)-1]
		if len(value) > 0 && value[len(value)-1] == '\r' {
			value = value[:len(value)-1]
		}
	}
	if len(value) == 0 || len(value) > maxRedisPasswordBytes ||
		bytes.IndexAny(value, "\r\n\x00") >= 0 || !utf8.Valid(value) {
		return nil, false
	}
	return value, true
}

func (material *materializedFiles) destroy() {
	if material == nil {
		return
	}
	clear(material.redisPassword)
	clear(material.attemptKey)
	clear(material.patSigningKey)
	material.redisPassword = nil
	material.attemptKey = nil
	material.patSigningKey = nil
	material.redisRoots = nil
	material.formProvider = nil
}
