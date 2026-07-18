package configurations

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/secrets"
)

func strVal(m map[string]any, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

var sensitiveFields = map[string]bool{
	"secret_access_key":     true,
	"aws_secret_access_key": true,
	"access_token":          true,
	"api_key":               true,
	"password":              true,
	"private_key":           true,
	"app_private_key":       true,
	"token":                 true,
	"connection_string":     true,
}

func isSensitiveField(key string) bool {
	if sensitiveFields[key] {
		return true
	}
	for sf := range sensitiveFields {
		if strings.HasSuffix(key, sf) {
			return true
		}
	}
	return false
}

func generateSecretName() string {
	b := make([]byte, 12)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func maskSecrets(pool *pgxpool.Pool, projectID string, data map[string]any, r *http.Request) map[string]any {
	if data == nil {
		return data
	}
	secretsHandler := secrets.NewHandler(pool)
	for key, val := range data {
		sv, ok := val.(string)
		if !ok || sv == "" {
			continue
		}
		if strings.HasPrefix(sv, "{{secret.") {
			continue
		}
		if !isSensitiveField(key) {
			continue
		}
		secretName := fmt.Sprintf("config_%s_%s", key, generateSecretName())
		err := secretsHandler.StoreSecret(r.Context(), r, projectID, secretName, sv)
		if err != nil {
			slog.Error("failed to store secret", "key", key, "err", err)
		} else {
			data[key] = fmt.Sprintf("{{secret.%s}}", secretName)
		}
	}
	return data
}
