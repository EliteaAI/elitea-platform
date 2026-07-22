package storage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/centrysecrets"
	"github.com/stretchr/testify/require"
)

type fakeSecretVault struct {
	regular map[string]string
	hidden  map[string]string
}

func (v *fakeSecretVault) Lookup(name string) (centrysecrets.Secret, error) {
	if value, ok := v.regular[name]; ok {
		return centrysecrets.Secret{Value: value}, nil
	}
	if value, ok := v.hidden[name]; ok {
		return centrysecrets.Secret{Value: value, Hidden: true}, nil
	}
	return centrysecrets.Secret{}, centrysecrets.ErrSecretNotFound
}

func (v *fakeSecretVault) LookupRegular(name string) (centrysecrets.Secret, error) {
	if value, ok := v.regular[name]; ok {
		return centrysecrets.Secret{Value: value}, nil
	}
	return centrysecrets.Secret{}, centrysecrets.ErrSecretNotFound
}

type fakeSecretVaultLoader struct {
	projects     map[int64]SecretVault
	admin        SecretVault
	projectLoads map[int64]int
	adminLoads   int
	err          error
}

func (l *fakeSecretVaultLoader) LoadProjectVault(_ context.Context, projectID int64) (SecretVault, error) {
	if l.err != nil {
		return nil, l.err
	}
	l.projectLoads[projectID]++
	vault, ok := l.projects[projectID]
	if !ok {
		return nil, ErrContentUnavailable
	}
	return vault, nil
}

func (l *fakeSecretVaultLoader) LoadAdminVault(context.Context) (SecretVault, error) {
	if l.err != nil {
		return nil, l.err
	}
	l.adminLoads++
	if l.admin == nil {
		return nil, ErrContentUnavailable
	}
	return l.admin, nil
}

func TestIndexInputMaterializerRedeemsOnlyBoundConfigurationFields(t *testing.T) {
	loader := validSecretVaultLoader()
	materializer, err := NewIndexInputMaterializer(loader, 1)
	require.NoError(t, err)
	authorization := indexToolkitAuthorization()

	first, err := materializer.MaterializeContent(context.Background(), authorization, validReferenceOnlyToolkit(), 256*1024)
	require.NoError(t, err)
	second, err := materializer.MaterializeContent(context.Background(), authorization, validReferenceOnlyToolkit(), 256*1024)
	require.NoError(t, err)
	require.Equal(t, first, second)
	require.NotContains(t, string(first), "{{secret.")
	require.NotContains(t, string(first), "GITHUB_TOKEN")
	require.NotContains(t, string(first), "PGVECTOR_DSN")

	var root map[string]any
	require.NoError(t, json.Unmarshal(first, &root))
	settings := root["settings"].(map[string]any)
	github := settings["github_configuration"].(map[string]any)
	pgvector := settings["pgvector_configuration"].(map[string]any)
	require.Equal(t, "project-github-token", github["access_token"])
	require.Equal(t, "postgresql://admin-fallback", pgvector["connection_string"])
	require.Equal(t, 2, loader.projectLoads[2])
	require.Equal(t, 2, loader.projectLoads[1])
	require.Equal(t, 2, loader.adminLoads)
}

func TestIndexInputMaterializerRejectsWrongBoundaryAndCredentialShapes(t *testing.T) {
	base := string(validReferenceOnlyToolkit())
	tests := []struct {
		name          string
		authorization ContentAuthorization
		input         string
	}{
		{name: "wrong capability", authorization: withCapability(indexToolkitAuthorization(), executiondomain.ConfigurationValidationCapability), input: base},
		{name: "wrong semantic role", authorization: withRole(indexToolkitAuthorization(), executiondomain.IndexToolParametersRole), input: base},
		{name: "wrong resource project", authorization: withProject(indexToolkitAuthorization(), "3"), input: base},
		{name: "noncanonical resource project", authorization: withProject(indexToolkitAuthorization(), "02"), input: base},
		{name: "plaintext github token", authorization: indexToolkitAuthorization(), input: strings.Replace(base, "{{secret.GITHUB_TOKEN}}", "plaintext-token", 1)},
		{name: "embedded pgvector reference", authorization: indexToolkitAuthorization(), input: strings.Replace(base, "{{secret.PGVECTOR_DSN}}", "postgresql://{{secret.PGVECTOR_DSN}}@db", 1)},
		{name: "secret outside approved field", authorization: indexToolkitAuthorization(), input: strings.Replace(base, `"repository":"elitea/example"`, `"repository":"{{secret.REPOSITORY}}"`, 1)},
		{name: "unknown credential field", authorization: indexToolkitAuthorization(), input: strings.Replace(base, `"base_url":"https://api.github.test"`, `"base_url":"https://api.github.test","client_secret":"{{secret.CLIENT_SECRET}}"`, 1)},
		{name: "cross-project vault", authorization: indexToolkitAuthorization(), input: strings.Replace(base, `"configuration_project_id":2`, `"configuration_project_id":9`, 1)},
		{name: "private configuration", authorization: indexToolkitAuthorization(), input: strings.Replace(base, `"private":false`, `"private":true`, 1)},
		{name: "partial username auth", authorization: indexToolkitAuthorization(), input: strings.Replace(base, `"username":null`, `"username":"user"`, 1)},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			loader := validSecretVaultLoader()
			materializer, err := NewIndexInputMaterializer(loader, 1)
			require.NoError(t, err)
			_, err = materializer.MaterializeContent(context.Background(), test.authorization, []byte(test.input), 256*1024)
			require.ErrorIs(t, err, ErrContentRejected)
			for _, protected := range []string{"plaintext-token", "CLIENT_SECRET", "postgresql://"} {
				require.NotContains(t, err.Error(), protected)
			}
		})
	}
}

func TestIndexInputMaterializerPreservesCredentialFreeEntriesAndRejectsMCP(t *testing.T) {
	materializer, err := NewIndexInputMaterializer(validSecretVaultLoader(), 1)
	require.NoError(t, err)
	authorization := indexToolkitAuthorization()

	entries := []struct {
		role string
		data []byte
	}{
		{role: executiondomain.IndexToolParametersRole, data: []byte(`{"clean_index":false,"index_name":"docs"}`)},
		{role: executiondomain.IndexLLMModelRole, data: []byte(`"gpt-test"`)},
		{role: executiondomain.IndexLLMConfigurationRole, data: []byte(`{"max_tokens":512,"model_name":"gpt-test","model_project_id":2,"openai_compatible":true,"temperature":0.1}`)},
	}
	for _, entry := range entries {
		authorization.SemanticRole = entry.role
		materialized, err := materializer.MaterializeContent(context.Background(), authorization, entry.data, int64(len(entry.data)))
		require.NoError(t, err)
		require.Equal(t, entry.data, materialized)
	}

	authorization.SemanticRole = executiondomain.IndexMCPTokensRole
	_, err = materializer.MaterializeContent(context.Background(), authorization, []byte(`{}`), 1024)
	require.ErrorIs(t, err, ErrContentRejected)

	authorization.SemanticRole = executiondomain.IndexToolParametersRole
	_, err = materializer.MaterializeContent(context.Background(), authorization, []byte(`{"access_token":"raw"}`), 1024)
	require.ErrorIs(t, err, ErrContentRejected)
}

func TestIndexInputMaterializerRequiresRegularAdminFallback(t *testing.T) {
	loader := validSecretVaultLoader()
	loader.admin = &fakeSecretVault{hidden: map[string]string{"PGVECTOR_DSN": "hidden-admin-must-not-cross-project"}}
	materializer, err := NewIndexInputMaterializer(loader, 1)
	require.NoError(t, err)

	_, err = materializer.MaterializeContent(context.Background(), indexToolkitAuthorization(), validReferenceOnlyToolkit(), 256*1024)
	require.ErrorIs(t, err, ErrContentRejected)
	require.NotContains(t, err.Error(), "hidden-admin")
}

func TestMaterializingContentServerKeepsSourceAndResponseIdentitiesDistinct(t *testing.T) {
	source := []byte(`{"access_token":"{{secret.TOKEN}}"}`)
	redeemed := []byte(`{"access_token":"redeemed"}`)
	sourceDigest := sha256.Sum256(source)
	redeemedDigest := sha256.Sum256(redeemed)
	fence := bytes.Repeat([]byte{9}, sha256.Size)
	certificate := &x509.Certificate{}
	materializer := contentMaterializerFunc(func(_ context.Context, authorization ContentAuthorization, data []byte, maxBytes int64) ([]byte, error) {
		require.Equal(t, source, data)
		require.Equal(t, sourceDigest, authorization.ExpectedDigest)
		require.GreaterOrEqual(t, maxBytes, int64(len(redeemed)))
		return append([]byte(nil), redeemed...), nil
	})
	server, err := NewMaterializingContentServerWithLimits(
		contentAuthorizerFunc(func(context.Context, ContentClaim) (ContentAuthorization, error) {
			return ContentAuthorization{
				ResourceProjectID: "2",
				InputBundleID:     "bundle-1",
				CapabilityID:      executiondomain.IndexIngestCapability,
				SemanticRole:      executiondomain.IndexToolkitConfigurationRole,
				ExpectedDigest:    sourceDigest,
				ExpectedLength:    int64(len(source)),
			}, nil
		}),
		contentStoreFunc(func(context.Context, string, string, string, string) (io.ReadCloser, error) {
			return io.NopCloser(bytes.NewReader(source)), nil
		}),
		materializer,
		1024,
		1,
	)
	require.NoError(t, err)

	request := httptest.NewRequest(http.MethodGet, "/executions/execution-1/generations/1/inputs/settings/versions/source-version", nil)
	request.TLS = &tls.ConnectionState{VerifiedChains: [][]*x509.Certificate{{certificate}}}
	request.Header.Set(claimIDHeader, "claim-1")
	request.Header.Set(fenceHeader, base64.RawURLEncoding.EncodeToString(fence))
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, request)

	require.Equal(t, http.StatusOK, response.Code)
	require.Equal(t, redeemed, response.Body.Bytes())
	require.Equal(t, formatSHA256Digest(redeemedDigest), response.Header().Get("Content-Digest"))
	require.Equal(t, formatSHA256Digest(sourceDigest), response.Header().Get(SourceContentDigestHeader))
	require.Equal(t, "source-version", response.Header().Get(SourceImmutableVersionHeader))
	require.Equal(t, strconv.Itoa(len(source)), response.Header().Get(SourceContentLengthHeader))
	require.NotEqual(t, response.Header().Get("Content-Digest"), response.Header().Get(SourceContentDigestHeader))
}

type contentMaterializerFunc func(context.Context, ContentAuthorization, []byte, int64) ([]byte, error)

func (f contentMaterializerFunc) MaterializeContent(ctx context.Context, authorization ContentAuthorization, source []byte, maxBytes int64) ([]byte, error) {
	return f(ctx, authorization, source, maxBytes)
}

func validSecretVaultLoader() *fakeSecretVaultLoader {
	return &fakeSecretVaultLoader{
		projects: map[int64]SecretVault{
			2: &fakeSecretVault{regular: map[string]string{"GITHUB_TOKEN": "project-github-token"}},
			1: &fakeSecretVault{regular: map[string]string{}},
		},
		admin:        &fakeSecretVault{regular: map[string]string{"PGVECTOR_DSN": "postgresql://admin-fallback"}},
		projectLoads: map[int64]int{},
	}
}

func indexToolkitAuthorization() ContentAuthorization {
	return ContentAuthorization{
		ResourceProjectID: "2",
		InputBundleID:     "bundle-1",
		CapabilityID:      executiondomain.IndexIngestCapability,
		SemanticRole:      executiondomain.IndexToolkitConfigurationRole,
		ExpectedLength:    int64(len(validReferenceOnlyToolkit())),
	}
}

func withCapability(authorization ContentAuthorization, capability string) ContentAuthorization {
	authorization.CapabilityID = capability
	return authorization
}

func withRole(authorization ContentAuthorization, role string) ContentAuthorization {
	authorization.SemanticRole = role
	return authorization
}

func withProject(authorization ContentAuthorization, project string) ContentAuthorization {
	authorization.ResourceProjectID = project
	return authorization
}

func validReferenceOnlyToolkit() []byte {
	return []byte(`{
		"id":41,
		"settings":{
			"active_branch":"main",
			"base_branch":"main",
			"embedding_model":"embedding-small",
			"repository":"elitea/example",
			"selected_tools":["index_data"],
			"github_configuration":{
				"access_token":"{{secret.GITHUB_TOKEN}}",
				"app_id":null,
				"app_private_key":null,
				"base_url":"https://api.github.test",
				"configuration_project_id":2,
				"configuration_type":"github",
				"configuration_uuid":"00000000-0000-0000-0000-000000000002",
				"elitea_title":"github-source",
				"password":null,
				"private":false,
				"username":null
			},
			"pgvector_configuration":{
				"configuration_project_id":1,
				"configuration_type":"pgvector",
				"configuration_uuid":"00000000-0000-0000-0000-000000000003",
				"connection_string":"{{secret.PGVECTOR_DSN}}",
				"elitea_title":"pgvector-public",
				"private":false
			}
		},
		"toolkit_name":"GitHub_One",
		"type":"github"
	}`)
}
