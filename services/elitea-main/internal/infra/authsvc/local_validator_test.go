package authsvc

import (
	"context"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v5"
)

func TestLocalValidatorRejectsNonLegacyHMACAlgorithmBeforeDatabaseAccess(t *testing.T) {
	secret := "test-secret"
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, tokenClaims{UUID: "8ce4be49-0d10-4f05-a63f-d6d46f99a3f0"})
	encoded, err := token.SignedString([]byte(secret))
	if err != nil {
		t.Fatal(err)
	}

	validator := NewLocalValidator(nil, secret)
	_, err = validator.ValidateToken(context.Background(), encoded)
	if err == nil || !strings.Contains(err.Error(), "unexpected signing method") {
		t.Fatalf("error = %v, want HS512 rejection", err)
	}
}
