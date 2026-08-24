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

func TestValidateRecordedLedgerRejectsDatabaseAheadAndMetadataDrift(t *testing.T) {
	t.Parallel()
	first := Migration{Scope: ScopeShared, Version: 1, Name: "first", Path: "shared/0001_first.sql", Checksum: sha256.Sum256([]byte("one"))}
	second := Migration{Scope: ScopeShared, Version: 2, Name: "second", Path: "shared/0002_second.sql", Checksum: sha256.Sum256([]byte("two"))}
	futureChecksum := sha256.Sum256([]byte("future"))
	manifest := []Migration{first, second}

	for name, recorded := range map[string][]recordedMigration{
		"database ahead":  {{version: 3, name: "future", checksum: futureChecksum[:]}},
		"renamed history": {{version: 1, name: "other", checksum: first.Checksum[:]}},
		"edited history":  {{version: 1, name: first.Name, checksum: second.Checksum[:]}},
	} {
		recorded := recorded
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			if _, err := validateRecordedLedger(manifest, recorded, false); err == nil {
				t.Fatal("ledger drift was accepted")
			}
		})
	}
	if _, err := validateRecordedLedger(manifest, []recordedMigration{{version: 1, name: first.Name, checksum: first.Checksum[:]}}, true); err == nil {
		t.Fatal("incomplete head was accepted")
	}
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
	// 84: shared/0084_budget_usage_dimensions.sql, the per-request usage ledger
	// and the nullable soft-alert thresholds that issues #320, #321 and #322
	// need. It follows shared/0083_viewer_secret_list_and_own_avatar.sql, the
	// two role splits #402 corrects, which itself follows the nine per-surface
	// permission grants #386 adds in 0074 to 0082.
	// 85: shared/0085_project_member_and_role_listings_administration.sql, the
	// two administration-mode listing grants #313 needs. It follows
	// shared/0084_budget_usage_dimensions.sql above.
	// 86: shared/0086_gateway_audio_prices.sql, the four per-1,000,000-unit
	// audio price columns the /llm/v1/audio/* routes need. It arrived on main
	// while the five below were in review, so they moved up one number each.
	// 87: shared/0087_artifact_object_expiry_from_object_age.sql, the backfill
	// that re-derives every artifact object's expires_at from its own
	// created_at. Rows written before the fix carry the bucket's frozen
	// deadline, and the ones already past it are swept within 15 minutes.
	// 88: shared/0088_administration_secret_permissions.sql, the four
	// administration-mode grants the global secret vault needs. Without them
	// every global-vault route answered 403, a super_admin included.
	// 89: shared/0089_central_system_role.sql, the central default-mode
	// `system` role the per-project machine identity resolves through. With no
	// such role the scheduled-execution PAT resolved the empty set and every
	// worker callback answered 403.
	// 90: shared/0090_project_override_reconciliation.sql, the one-time
	// delivery of the corpus's default-mode grants to the projects whose own
	// permission rows suppress the central fallback.
	// 91: shared/0091_pylon_viewer_secret_list_parity.sql, which withdraws
	// 0083's `configuration.secrets.secret.list` grant from the default-mode
	// `viewer` on a pylon-managed auth_core. 0083 states that no existing
	// deployment gains anything; a pylon-backed database carries no per-project
	// permission row, so the central fallback is live there and every project
	// viewer did gain the secret listing.
	// 93: shared/0093_governance_config_type_check.sql, which constrains
	// gateway.governance_config.type to the value set every reader switches on,
	// and carries the correction 0067's checksum-immutable header could not: the
	// gateway now DOES read this table (#218). The constraint is NOT VALID so an
	// existing row with an unknown type does not fail the release.
	// 94: shared/0094_mcp_prebuilt_catalogue.sql, the platform-wide catalogue of
	// pre-built MCP servers. It replaces the indexer_worker plugin descriptor
	// block that pylon distributes over the Arbiter event bus, which this service
	// has no way to read.
	//
	// It was written as 0092 and renumbered here. 0093's header records that it
	// left 0092 free for this file, and 92 IS still free — but a free number is
	// not the rule. scripts/database/check-migration-version.sh requires an added
	// migration to be ABOVE the base head, gap or no gap, so that two deployments
	// applying the corpus at different times apply it in the same order. The
	// ledger would have tolerated the back-fill; the policy does not, and the
	// policy is the stricter of the two on purpose.
	//
	// 92 stays empty. Nothing needs to fill it: LoadManifest sorts by version and
	// Head() reads the last entry, so a gap costs nothing.
	// 95: shared/0095_identity_providers.sql, the typed identity provider
	// revision. It replaces the four environment variables that were this
	// service's only federation configuration, and gives the admin
	// Configuration page's Authentication section a store and a reader.
	// 96: shared/0096_scim_provisioning.sql, the side table SCIM 2.0 user
	// provisioning needs. It holds the identity provider's externalId and the
	// resource timestamps, keyed by user id — the account row itself is
	// pylon-owned and is read and updated, never reshaped.
	// 97: shared/0097_gateway_model_price_override.sql, which lets an operator
	// author a model price that the scheduler's price-sync UPSERT will not
	// overwrite. The column is the handshake between two writers of the same
	// row: without it the syncer's ON CONFLICT DO UPDATE reassigns every price
	// column from EXCLUDED, so an authored price is correct until the next tick
	// and then silently reverts.
	//
	// It was written as 0095 and renumbered on merge: 0095 and 0096 landed on
	// main while this was in review. Both authors were right when they wrote the
	// number and only one could stay — the same collision 0094's header records,
	// and the reason check-migration-version.sh reads the base branch at check
	// time rather than the pull request's own history.
	// 98: shared/0098_scim_group_bindings.sql, the authored binding of one SCIM
	// group to one project role, and the ledger of what a push granted. It
	// reverses 0096's refusal of /Groups: the project and the role are authored
	// by an administrator before any push, so the identity provider supplies the
	// membership and never invents the half a SCIM group cannot carry.
	//
	// It was written as 0097 and renumbered on merge, for the reason the entry
	// above records: 0097 landed on main while this was in review, and a number
	// is claimed at merge rather than at authoring.
	// 99: shared/0099_gateway_request_logs.sql, the gateway's per-request log.
	// It is a THIRD per-request table beside the money accumulator and the
	// billing ledger, and the reason is that a billing delta rides only a
	// BILLED request — so a call refused by a budget, rejected by a policy,
	// addressed to an unresolvable model or failed upstream produces no ledger
	// row at all. A log built over the ledger would list successes and no
	// failures, which is the opposite of what a log is for.
	//
	// It stores NO request or response content, including no upstream error
	// text: the failure column is a classification the gateway assigns, so
	// there is no column a prompt fragment can reach.
	require.EqualValues(t, 99, Head(shared))

	tenant, err := LoadManifest(platformmigrations.Files, ScopeTenant)
	require.NoError(t, err)
	// 125: tenant/0125_entity_tool_mapping_entity_id.sql.
	require.EqualValues(t, 125, Head(tenant))
}
