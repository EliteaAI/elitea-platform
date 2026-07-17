package migrate

import (
	"crypto/sha256"
	"testing"
	"testing/fstest"

	platformmigrations "github.com/EliteaAI/elitea-platform/services/elitea-main/migrations"
	"github.com/stretchr/testify/require"
)

func TestLoadManifestOrdersAndHashesMigrations(t *testing.T) {
	t.Parallel()

	files := fstest.MapFS{
		"shared/0030_second.sql": {Data: []byte("SELECT 2")},
		"shared/0001_first.sql":  {Data: []byte("SELECT 1")},
	}
	manifest, err := LoadManifest(files, ScopeShared)
	require.NoError(t, err)
	require.Equal(t, []int64{1, 30}, []int64{manifest[0].Version, manifest[1].Version})
	require.Equal(t, sha256.Sum256([]byte("SELECT 1")), manifest[0].Checksum)
}

func TestLoadManifestRejectsInvalidAndDuplicateFiles(t *testing.T) {
	t.Parallel()

	tests := map[string]fstest.MapFS{
		"invalid name": {
			"shared/latest.sql": {Data: []byte("SELECT 1")},
		},
		"duplicate version": {
			"shared/0001_first.sql":  {Data: []byte("SELECT 1")},
			"shared/0001_second.sql": {Data: []byte("SELECT 2")},
		},
		"empty migration": {
			"shared/0001_first.sql": {Data: nil},
		},
	}

	for name, files := range tests {
		files := files
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			_, err := LoadManifest(files, ScopeShared)
			require.Error(t, err)
		})
	}
}

func TestVerifyChecksumRejectsEditedAppliedMigration(t *testing.T) {
	t.Parallel()

	migration := Migration{Path: "shared/0001_first.sql", Checksum: sha256.Sum256([]byte("new"))}
	recorded := sha256.Sum256([]byte("old"))
	require.Error(t, verifyChecksum(migration, recorded[:]))
}

func TestAdvisoryLockKeyIsScopedAndStable(t *testing.T) {
	t.Parallel()

	require.Equal(t, advisoryLockKey(ScopeShared, "platform"), advisoryLockKey(ScopeShared, "platform"))
	require.NotEqual(t, advisoryLockKey(ScopeShared, "platform"), advisoryLockKey(ScopeTenant, "platform"))
	require.NotEqual(t, advisoryLockKey(ScopeTenant, "1"), advisoryLockKey(ScopeTenant, "2"))
}

func TestEmbeddedHistoriesHaveExpectedHeads(t *testing.T) {
	t.Parallel()

	shared, err := LoadManifest(platformmigrations.Files, ScopeShared)
	require.NoError(t, err)
	require.EqualValues(t, 32, Head(shared))

	tenant, err := LoadManifest(platformmigrations.Files, ScopeTenant)
	require.NoError(t, err)
	require.EqualValues(t, 120, Head(tenant))
}
