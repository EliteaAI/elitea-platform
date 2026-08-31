package auth

import (
	"testing"

	"github.com/stretchr/testify/require"
)

// The matching rule, spelled out as a table.
//
// The scripted half of the guarantee. It fixes WHICH spellings of a configured
// entry name this login; whether the grant then reaches the database is what
// first_login_postgres_integration_test.go asserts, because only PostgreSQL can
// answer that.
func TestInitialGlobalAdminMatchingAcceptsBothSpellings(t *testing.T) {
	for _, testCase := range []struct {
		name        string
		admins      []string
		providerRef string
		want        bool
	}{
		{
			name:        "a bare entry names an OIDC subject",
			admins:      []string{"alice-sub"},
			providerRef: OIDCProviderRefPrefix + "alice-sub",
			want:        true,
		},
		{
			name:        "the prefixed spelling of the same entry also names it",
			admins:      []string{OIDCProviderRefPrefix + "alice-sub"},
			providerRef: OIDCProviderRefPrefix + "alice-sub",
			want:        true,
		},
		{
			name:        "a bare entry names a SAML NameID",
			admins:      []string{"alice-nameid"},
			providerRef: SAMLProviderRefPrefix + "alice-nameid",
			want:        true,
		},
		{
			name:        "the prefixed SAML spelling also names it",
			admins:      []string{SAMLProviderRefPrefix + "alice-nameid"},
			providerRef: SAMLProviderRefPrefix + "alice-nameid",
			want:        true,
		},
		{
			// The namespace is part of the identity, not decoration. An entry
			// written for one protocol must not promote the other protocol's
			// subject of the same name; the two can be different people at
			// different identity providers.
			name:        "a prefixed entry does not cross protocols",
			admins:      []string{OIDCProviderRefPrefix + "alice"},
			providerRef: SAMLProviderRefPrefix + "alice",
			want:        false,
		},
		{
			name:        "an unlisted subject matches nothing",
			admins:      []string{"alice-sub"},
			providerRef: OIDCProviderRefPrefix + "mallory-sub",
			want:        false,
		},
		{
			// A suffix, a substring and a lookalike are all misses. The
			// comparison is on the whole reference.
			name:        "matching is not a prefix or substring test",
			admins:      []string{"alice"},
			providerRef: OIDCProviderRefPrefix + "alice-sub",
			want:        false,
		},
		{
			name:        "an empty list promotes nobody",
			admins:      nil,
			providerRef: OIDCProviderRefPrefix + "alice-sub",
			want:        false,
		},
		{
			// An empty entry would otherwise match a reference this plane
			// cannot produce, but the list is operator input and a stray blank
			// line must never be a grant.
			name:        "an empty entry promotes nobody",
			admins:      []string{""},
			providerRef: OIDCProviderRefPrefix + "",
			want:        false,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			require.Equal(t, testCase.want,
				matchesInitialGlobalAdmin(testCase.admins, testCase.providerRef))
		})
	}
}

func TestInitialGlobalAdminsFromEnvSplitsAndTrims(t *testing.T) {
	t.Setenv("ELITEA_INITIAL_GLOBAL_ADMINS", " alice-sub , oidc:bob-sub ,, ")
	require.Equal(t,
		[]string{"alice-sub", OIDCProviderRefPrefix + "bob-sub"},
		InitialGlobalAdminsFromEnv())
}

func TestInitialGlobalAdminsFromEnvIsEmptyWhenUnset(t *testing.T) {
	t.Setenv("ELITEA_INITIAL_GLOBAL_ADMINS", "")
	require.Empty(t, InitialGlobalAdminsFromEnv())
}
