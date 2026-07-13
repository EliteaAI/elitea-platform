package storage

import "os"

// Config holds storage backend configuration.
type Config struct {
	Backend string // "filesystem" | "s3" | "gcs" | "azure"

	// Filesystem
	DataDir string

	// S3 / MinIO
	S3Endpoint       string
	S3AccessKey      string
	S3SecretKey      string
	S3Region         string
	S3ForcePathStyle bool

	// GCS
	GCSBucket          string
	GCSCredentialsFile string

	// Azure Blob
	AzureAccount   string
	AzureKey       string
	AzureContainer string
}

// ConfigFromEnv reads storage configuration from environment variables.
func ConfigFromEnv() Config {
	dataDir := os.Getenv("ARTIFACTS_DATA_DIR")
	if dataDir == "" {
		dataDir = "/data/artifacts"
	}

	return Config{
		Backend: envOr("STORAGE_BACKEND", "filesystem"),
		DataDir: dataDir,

		S3Endpoint:       os.Getenv("S3_ENDPOINT_URL"),
		S3AccessKey:      os.Getenv("S3_ACCESS_KEY"),
		S3SecretKey:      os.Getenv("S3_SECRET_KEY"),
		S3Region:         envOr("S3_REGION", "us-east-1"),
		S3ForcePathStyle: os.Getenv("S3_FORCE_PATH_STYLE") == "true",

		GCSBucket:          os.Getenv("GCS_BUCKET"),
		GCSCredentialsFile: os.Getenv("GOOGLE_APPLICATION_CREDENTIALS"),

		AzureAccount:   os.Getenv("AZURE_STORAGE_ACCOUNT"),
		AzureKey:       os.Getenv("AZURE_STORAGE_KEY"),
		AzureContainer: envOr("AZURE_STORAGE_CONTAINER", "elitea"),
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
