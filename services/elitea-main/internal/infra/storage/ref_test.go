package storage

import (
	"errors"
	"strings"
	"testing"
)

const (
	validProjectID = "123"
	validBucket    = "my-bucket"
	validKey       = "a/b/c.txt"
)

func TestNewObjectRefRejectsInvalidKeys(t *testing.T) {
	cases := map[string]string{
		"dot-dot segment leading":  "../x",
		"dot-dot segment interior": "a/../b",
		"leading slash":            "/a",
		"double slash":             "a//b",
		"trailing slash":           "a/",
		"empty key":                "",
		"1025 byte key":            strings.Repeat("a", 1025),
		"embedded NUL":             "a\x00b",
		"embedded DEL":             "a\x7fb",
		"invalid UTF-8":            "a\xffb",
	}
	for name, key := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := NewObjectRef(validProjectID, validBucket, key); !errors.Is(err, ErrInvalidKey) {
				t.Fatalf("NewObjectRef(%q, %q, %q) = _, %v; want ErrInvalidKey", validProjectID, validBucket, key, err)
			}
		})
	}
}

func TestNewObjectRefRejectsInvalidProjectIDs(t *testing.T) {
	cases := map[string]string{
		"zero":         "0",
		"leading zero": "01",
		"negative":     "-1",
		"decimal":      "1.2",
		"empty":        "",
	}
	for name, projectID := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := NewObjectRef(projectID, validBucket, validKey); !errors.Is(err, ErrInvalidKey) {
				t.Fatalf("NewObjectRef(%q, ...) = _, %v; want ErrInvalidKey", projectID, err)
			}
			if _, err := NewBucketRef(projectID, validBucket); !errors.Is(err, ErrInvalidKey) {
				t.Fatalf("NewBucketRef(%q, ...) = _, %v; want ErrInvalidKey", projectID, err)
			}
		})
	}
}

func TestNewObjectRefRejectsInvalidBucketNames(t *testing.T) {
	cases := map[string]string{
		"uppercase":     "A",
		"leading digit": "1abc",
		"too short":     "a",
		"underscore":    "a_b",
		"64 character":  strings.Repeat("a", 64),
	}
	for name, bucket := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := NewObjectRef(validProjectID, bucket, validKey); !errors.Is(err, ErrInvalidKey) {
				t.Fatalf("NewObjectRef(..., %q, ...) = _, %v; want ErrInvalidKey", bucket, err)
			}
			if _, err := NewBucketRef(validProjectID, bucket); !errors.Is(err, ErrInvalidKey) {
				t.Fatalf("NewBucketRef(..., %q) = _, %v; want ErrInvalidKey", bucket, err)
			}
		})
	}
}

func TestNewObjectRefAcceptsValidInputs(t *testing.T) {
	ref, err := NewObjectRef(validProjectID, validBucket, validKey)
	if err != nil {
		t.Fatalf("NewObjectRef(%q, %q, %q) returned %v, want nil", validProjectID, validBucket, validKey, err)
	}
	if ref.ProjectID() != validProjectID || ref.Bucket() != validBucket || ref.Key() != validKey {
		t.Fatalf("NewObjectRef round-trip mismatch: got (%q, %q, %q)", ref.ProjectID(), ref.Bucket(), ref.Key())
	}

	bucketRef, err := NewBucketRef(validProjectID, validBucket)
	if err != nil {
		t.Fatalf("NewBucketRef(%q, %q) returned %v, want nil", validProjectID, validBucket, err)
	}
	if bucketRef.Key() != "" {
		t.Fatalf("NewBucketRef Key() = %q, want empty", bucketRef.Key())
	}
}

func TestValidateKeyPrefix(t *testing.T) {
	accept := []string{"", "folder/", "a/b/"}
	for _, p := range accept {
		t.Run("accept_"+p, func(t *testing.T) {
			if err := ValidateKeyPrefix(p); err != nil {
				t.Fatalf("ValidateKeyPrefix(%q) = %v, want nil", p, err)
			}
		})
	}

	reject := []string{"../", "/a", "a//b"}
	for _, p := range reject {
		t.Run("reject_"+p, func(t *testing.T) {
			if err := ValidateKeyPrefix(p); !errors.Is(err, ErrInvalidKey) {
				t.Fatalf("ValidateKeyPrefix(%q) = %v, want ErrInvalidKey", p, err)
			}
		})
	}
}

func TestObjectRefStorageKey(t *testing.T) {
	ref, err := NewObjectRef("42", "reports", "quarter/q1.csv")
	if err != nil {
		t.Fatalf("NewObjectRef: %v", err)
	}

	if got, want := ref.StorageKey(""), "p/42/b/reports/o/quarter/q1.csv"; got != want {
		t.Fatalf("StorageKey(\"\") = %q, want %q", got, want)
	}
	if got, want := ref.StorageKey("elitea-artifacts"), "elitea-artifacts/p/42/b/reports/o/quarter/q1.csv"; got != want {
		t.Fatalf("StorageKey(prefix) = %q, want %q", got, want)
	}
	if got, want := ref.BucketPrefix(""), "p/42/b/reports/o/"; got != want {
		t.Fatalf("BucketPrefix(\"\") = %q, want %q", got, want)
	}
	if got, want := ref.BucketPrefix("elitea-artifacts"), "elitea-artifacts/p/42/b/reports/o/"; got != want {
		t.Fatalf("BucketPrefix(prefix) = %q, want %q", got, want)
	}
	if got, want := ref.StorageKey(""), ref.BucketPrefix("")+ref.Key(); got != want {
		t.Fatalf("StorageKey(\"\") = %q, want BucketPrefix()+Key() = %q", got, want)
	}
}

func TestNewPlatformObjectRef(t *testing.T) {
	ref, err := NewPlatformObjectRef("branding", "logo-full/abc.svg")
	if err != nil {
		t.Fatalf("NewPlatformObjectRef: %v", err)
	}
	if ref.ProjectID() != PlatformScopeID || ref.Bucket() != "branding" || ref.Key() != "logo-full/abc.svg" {
		t.Fatalf("ref = %+v", ref)
	}
	if got := ref.StorageKey(""); got != "p/platform/b/branding/o/logo-full/abc.svg" {
		t.Fatalf("StorageKey = %q", got)
	}
	// The platform scope can never be a project id, and the key rules still apply.
	if _, err := NewObjectRef(PlatformScopeID, "branding", "x"); err == nil {
		t.Fatal("NewObjectRef accepted the platform scope as a project id")
	}
	if _, err := NewPlatformObjectRef("branding", "../escape"); err == nil {
		t.Fatal("NewPlatformObjectRef accepted a .. segment")
	}
	if _, err := NewPlatformObjectRef("Bad Bucket", "k"); err == nil {
		t.Fatal("NewPlatformObjectRef accepted an invalid bucket")
	}
}
