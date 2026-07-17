// Package runtimecomposition owns the optional production runtime dependency
// graph and its lifecycle. The legacy HTTP surface remains compatible while
// this package is disabled.
package runtimecomposition

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/transport/runtimegrpc"
)

const (
	maxConfigPathBytes       = 4096
	maxRedisURLBytes         = 2048
	maxRedisPoolSize         = 64
	maxRuntimeOutstanding    = 1024
	maxRuntimeStreamEntries  = 1024
	productionRedisEntrySize = 64 * 1024
)

type LookupEnv func(string) (string, bool)

type Config struct {
	Enabled bool

	CommandStream    string
	MaxOutstanding   int64
	StreamMaxEntries int64

	RedisURL          string
	RedisPasswordFile string
	RedisCAFile       string
	RedisPoolSize     int

	SigningKeyID            string
	SigningKeyFile          string
	VerificationKeyringFile string

	ControlAddress string
	OutputAddress  string
	ContentAddress string
	ControlTLS     runtimegrpc.ServerTLSFiles
	OutputTLS      runtimegrpc.ServerTLSFiles
	ContentTLS     runtimegrpc.ServerTLSFiles
}

func ConfigFromEnv(lookup LookupEnv) (Config, error) {
	if lookup == nil {
		return Config{}, errors.New("runtime environment lookup is required")
	}
	enabledValue, _ := lookup("ELITEA_RUNTIME_ENABLED")
	switch enabledValue {
	case "", "false":
		return Config{}, nil
	case "true":
	default:
		return Config{}, errors.New("ELITEA_RUNTIME_ENABLED must be true or false")
	}

	required := func(name string) (string, error) {
		value, ok := lookup(name)
		if !ok || value == "" {
			return "", fmt.Errorf("%s is required when the runtime is enabled", name)
		}
		return value, nil
	}
	integer := func(name string) (int64, error) {
		value, err := required(name)
		if err != nil {
			return 0, err
		}
		parsed, err := strconv.ParseInt(value, 10, 64)
		if err != nil {
			return 0, fmt.Errorf("%s must be a canonical positive integer", name)
		}
		if parsed <= 0 || strconv.FormatInt(parsed, 10) != value {
			return 0, fmt.Errorf("%s must be a canonical positive integer", name)
		}
		return parsed, nil
	}

	var config Config
	config.Enabled = true
	var err error
	if config.CommandStream, err = required("ELITEA_RUNTIME_COMMAND_STREAM"); err != nil {
		return Config{}, err
	}
	if config.MaxOutstanding, err = integer("ELITEA_RUNTIME_MAX_OUTSTANDING"); err != nil {
		return Config{}, err
	}
	if config.StreamMaxEntries, err = integer("ELITEA_RUNTIME_STREAM_MAX_ENTRIES"); err != nil {
		return Config{}, err
	}
	if config.RedisURL, err = required("ELITEA_RUNTIME_REDIS_URL"); err != nil {
		return Config{}, err
	}
	if config.RedisPasswordFile, err = required("ELITEA_RUNTIME_REDIS_PASSWORD_FILE"); err != nil {
		return Config{}, err
	}
	if config.RedisCAFile, err = required("ELITEA_RUNTIME_REDIS_CA_FILE"); err != nil {
		return Config{}, err
	}
	poolSize, err := integer("ELITEA_RUNTIME_REDIS_POOL_SIZE")
	if err != nil {
		return Config{}, err
	}
	if poolSize > int64(^uint(0)>>1) {
		return Config{}, errors.New("ELITEA_RUNTIME_REDIS_POOL_SIZE exceeds this platform")
	}
	config.RedisPoolSize = int(poolSize)
	if config.SigningKeyID, err = required("ELITEA_RUNTIME_SIGNING_KEY_ID"); err != nil {
		return Config{}, err
	}
	if config.SigningKeyFile, err = required("ELITEA_RUNTIME_SIGNING_KEY_FILE"); err != nil {
		return Config{}, err
	}
	if config.VerificationKeyringFile, err = required("ELITEA_RUNTIME_VERIFICATION_KEYRING_FILE"); err != nil {
		return Config{}, err
	}
	if config.ControlAddress, err = required("ELITEA_RUNTIME_CONTROL_ADDRESS"); err != nil {
		return Config{}, err
	}
	if config.OutputAddress, err = required("ELITEA_RUNTIME_OUTPUT_ADDRESS"); err != nil {
		return Config{}, err
	}
	if config.ContentAddress, err = required("ELITEA_RUNTIME_CONTENT_ADDRESS"); err != nil {
		return Config{}, err
	}

	loadTLSFiles := func(prefix string) (runtimegrpc.ServerTLSFiles, error) {
		certificate, err := required(prefix + "_CERT_FILE")
		if err != nil {
			return runtimegrpc.ServerTLSFiles{}, err
		}
		privateKey, err := required(prefix + "_KEY_FILE")
		if err != nil {
			return runtimegrpc.ServerTLSFiles{}, err
		}
		clientCA, err := required(prefix + "_CLIENT_CA_FILE")
		if err != nil {
			return runtimegrpc.ServerTLSFiles{}, err
		}
		return runtimegrpc.ServerTLSFiles{CertificateChainPath: certificate, PrivateKeyPath: privateKey, ClientCAPath: clientCA}, nil
	}
	if config.ControlTLS, err = loadTLSFiles("ELITEA_RUNTIME_CONTROL_TLS"); err != nil {
		return Config{}, err
	}
	if config.OutputTLS, err = loadTLSFiles("ELITEA_RUNTIME_OUTPUT_TLS"); err != nil {
		return Config{}, err
	}
	if config.ContentTLS, err = loadTLSFiles("ELITEA_RUNTIME_CONTENT_TLS"); err != nil {
		return Config{}, err
	}
	if err := config.Validate(); err != nil {
		return Config{}, err
	}
	return config, nil
}

func (c Config) Validate() error {
	if !c.Enabled {
		return nil
	}
	if c.CommandStream == "" || len(c.CommandStream) > 256 || strings.ContainsAny(c.CommandStream, " \r\n\x00") {
		return errors.New("runtime command stream is invalid")
	}
	if c.MaxOutstanding <= 0 || c.MaxOutstanding > maxRuntimeOutstanding {
		return errors.New("runtime durable admission capacity is invalid")
	}
	if c.StreamMaxEntries <= 0 || c.StreamMaxEntries > maxRuntimeStreamEntries {
		return errors.New("runtime Redis stream capacity is invalid")
	}
	if c.RedisPoolSize <= 0 || c.RedisPoolSize > maxRedisPoolSize {
		return errors.New("runtime Redis pool size is invalid")
	}
	if err := validateRedisURL(c.RedisURL); err != nil {
		return err
	}
	for _, path := range []string{
		c.RedisPasswordFile, c.RedisCAFile, c.SigningKeyFile, c.VerificationKeyringFile,
		c.ControlTLS.CertificateChainPath, c.ControlTLS.PrivateKeyPath, c.ControlTLS.ClientCAPath,
		c.OutputTLS.CertificateChainPath, c.OutputTLS.PrivateKeyPath, c.OutputTLS.ClientCAPath,
		c.ContentTLS.CertificateChainPath, c.ContentTLS.PrivateKeyPath, c.ContentTLS.ClientCAPath,
	} {
		if !validConfigPath(path) {
			return errors.New("runtime secret or TLS file path is invalid")
		}
	}
	if c.SigningKeyID == "" || len(c.SigningKeyID) > 256 || strings.ContainsAny(c.SigningKeyID, "\r\n\x00") {
		return errors.New("runtime signing key ID is invalid")
	}
	addresses := []string{c.ControlAddress, c.OutputAddress, c.ContentAddress}
	if addresses[0] == addresses[1] || addresses[0] == addresses[2] || addresses[1] == addresses[2] {
		return errors.New("runtime listeners require distinct addresses")
	}
	for _, address := range addresses {
		if err := validateTCPAddress(address); err != nil {
			return err
		}
	}
	return nil
}

func validateRedisURL(raw string) error {
	if raw == "" || len(raw) > maxRedisURLBytes || !canonicalRedisURLText(raw) {
		return errors.New("runtime Redis URL is invalid")
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "rediss" || parsed.Host == "" || parsed.Fragment != "" || parsed.RawQuery != "" || parsed.ForceQuery || parsed.RawPath != "" || parsed.User == nil || parsed.User.Username() == "" {
		return errors.New("runtime Redis URL must be a rediss URL with an ACL username")
	}
	if _, passwordPresent := parsed.User.Password(); passwordPresent {
		return errors.New("runtime Redis password must come from its configured file")
	}
	username := parsed.User.Username()
	if !validRedisACLUsername(username) || parsed.User.String() != username {
		return errors.New("runtime Redis ACL username is not canonical")
	}
	port, err := strconv.Atoi(parsed.Port())
	if parsed.Hostname() == "" || err != nil || port <= 0 || port > 65535 || strconv.Itoa(port) != parsed.Port() {
		return errors.New("runtime Redis URL must include a numeric TCP port")
	}
	if parsed.Path != "/0" {
		return errors.New("runtime Redis URL must select database zero explicitly")
	}
	return nil
}

func canonicalRedisURLText(raw string) bool {
	for index := 0; index < len(raw); index++ {
		character := raw[index]
		if character < '!' || character > '~' || character == '%' || character == '?' || character == '#' {
			return false
		}
	}
	return true
}

func validRedisACLUsername(username string) bool {
	if username == "" || len(username) > 256 {
		return false
	}
	for index := 0; index < len(username); index++ {
		character := username[index]
		if (character >= 'a' && character <= 'z') ||
			(character >= 'A' && character <= 'Z') ||
			(character >= '0' && character <= '9') ||
			character == '.' || character == '_' || character == '-' {
			continue
		}
		return false
	}
	return true
}

func validConfigPath(path string) bool {
	return path != "" && len(path) <= maxConfigPathBytes && !strings.ContainsAny(path, "\r\n\x00")
}

func validateTCPAddress(address string) error {
	if len(address) > 256 || strings.ContainsAny(address, "\r\n\x00") {
		return errors.New("runtime listener address is invalid")
	}
	_, portValue, err := net.SplitHostPort(address)
	if err != nil {
		return errors.New("runtime listener address must include a numeric TCP port")
	}
	port, err := strconv.Atoi(portValue)
	if err != nil || port <= 0 || port > 65535 {
		return errors.New("runtime listener address must include a numeric TCP port")
	}
	return nil
}
