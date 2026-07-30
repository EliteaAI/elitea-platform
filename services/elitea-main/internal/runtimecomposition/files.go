package runtimecomposition

import (
	"bytes"
	"crypto/ed25519"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/security/securefile"
)

const (
	maxSigningKeyFileBytes = 64 * 1024
	maxPasswordFileBytes   = 514
	maxRedisPasswordBytes  = 512
	maxRedisCAFileBytes    = 1 << 20
	encodedFernetKeyBytes  = 44
)

func loadEd25519PrivateKey(path string) (ed25519.PrivateKey, error) {
	contents, err := securefile.Read(path, maxSigningKeyFileBytes, securefile.PrivateMaterial)
	if err != nil {
		return nil, fmt.Errorf("load command-signing key: %w", err)
	}
	block, rest := pem.Decode(contents)
	if block == nil || block.Type != "PRIVATE KEY" || len(strings.TrimSpace(string(rest))) != 0 {
		return nil, errors.New("command-signing key must be one PKCS#8 PRIVATE KEY PEM block")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse command-signing key: %w", err)
	}
	privateKey, ok := parsed.(ed25519.PrivateKey)
	if !ok || len(privateKey) != ed25519.PrivateKeySize {
		return nil, errors.New("command-signing key is not Ed25519")
	}
	return append(ed25519.PrivateKey(nil), privateKey...), nil
}

func loadOptionalFernetMasterKey(path string) ([]byte, error) {
	if path == "" {
		return nil, nil
	}
	contents, err := securefile.Read(path, encodedFernetKeyBytes, securefile.PrivateMaterial)
	if err != nil {
		return nil, fmt.Errorf("load current secret-vault master key: %w", err)
	}
	var decoded [33]byte
	n, decodeErr := base64.URLEncoding.Decode(decoded[:], contents)
	clear(decoded[:])
	if decodeErr != nil || n != 32 || len(contents) != encodedFernetKeyBytes {
		clear(contents)
		return nil, errors.New("current secret-vault master key is not a Fernet key")
	}
	return contents, nil
}

func loadPassword(path string) (string, error) {
	contents, err := securefile.Read(path, maxPasswordFileBytes, securefile.PrivateMaterial)
	if err != nil {
		return "", fmt.Errorf("load runtime Redis password: %w", err)
	}
	if contents[len(contents)-1] == '\n' {
		contents = contents[:len(contents)-1]
		if len(contents) > 0 && contents[len(contents)-1] == '\r' {
			contents = contents[:len(contents)-1]
		}
	}
	if len(contents) == 0 || len(contents) > maxRedisPasswordBytes ||
		bytes.ContainsAny(contents, "\r\n\x00") || !utf8.Valid(contents) {
		return "", errors.New("runtime Redis password file is invalid")
	}
	return string(contents), nil
}

func loadRedisRoots(path string) (*x509.CertPool, error) {
	contents, err := securefile.Read(path, maxRedisCAFileBytes, securefile.PublicMaterial)
	if err != nil {
		return nil, fmt.Errorf("load runtime Redis CA: %w", err)
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(contents) {
		return nil, errors.New("runtime Redis CA file contains no certificates")
	}
	return roots, nil
}

func redisTLSConfig(serverName string, roots *x509.CertPool) (*tls.Config, error) {
	if serverName == "" || roots == nil {
		return nil, errors.New("runtime Redis TLS server name and roots are required")
	}
	return &tls.Config{
		MinVersion: tls.VersionTLS13,
		ServerName: serverName,
		RootCAs:    roots,
	}, nil
}
