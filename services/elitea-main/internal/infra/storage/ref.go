package storage

import (
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

var (
	projectIDPattern = regexp.MustCompile(`^[1-9][0-9]{0,17}$`)
	bucketPattern    = regexp.MustCompile(`^[a-z][a-z0-9-]{1,62}$`)
)

// ObjectRef identifies a single object within a project's bucket, or a
// bucket alone when Key() is empty. The zero value is invalid; construct one
// via NewObjectRef or NewBucketRef.
type ObjectRef struct {
	projectID, bucket, key string
}

// NewObjectRef validates projectID, bucket, and key and returns a ref
// identifying a single object. Every rejection wraps ErrInvalidKey.
func NewObjectRef(projectID, bucket, key string) (ObjectRef, error) {
	ref, err := NewBucketRef(projectID, bucket)
	if err != nil {
		return ObjectRef{}, err
	}
	if err := validateKey(key); err != nil {
		return ObjectRef{}, err
	}
	ref.key = key
	return ref, nil
}

// NewBucketRef validates projectID and bucket and returns a ref with an
// empty key, identifying the bucket itself.
func NewBucketRef(projectID, bucket string) (ObjectRef, error) {
	if !projectIDPattern.MatchString(projectID) {
		return ObjectRef{}, fmt.Errorf("%w: invalid project id %q", ErrInvalidKey, projectID)
	}
	if !bucketPattern.MatchString(bucket) {
		return ObjectRef{}, fmt.Errorf("%w: invalid bucket %q", ErrInvalidKey, bucket)
	}
	return ObjectRef{projectID: projectID, bucket: bucket}, nil
}

func validateKey(key string) error {
	if key == "" {
		return fmt.Errorf("%w: key is empty", ErrInvalidKey)
	}
	if len(key) > 1024 {
		return fmt.Errorf("%w: key exceeds 1024 bytes", ErrInvalidKey)
	}
	if !utf8.ValidString(key) {
		return fmt.Errorf("%w: key is not valid UTF-8", ErrInvalidKey)
	}
	for _, r := range key {
		if r < 0x20 || r == 0x7f {
			return fmt.Errorf("%w: key contains a control character", ErrInvalidKey)
		}
	}
	if strings.HasPrefix(key, "/") {
		return fmt.Errorf("%w: key has a leading slash", ErrInvalidKey)
	}
	if strings.HasSuffix(key, "/") {
		return fmt.Errorf("%w: key has a trailing slash", ErrInvalidKey)
	}
	if strings.Contains(key, "//") {
		return fmt.Errorf("%w: key contains an empty path segment", ErrInvalidKey)
	}
	for _, segment := range strings.Split(key, "/") {
		if segment == "." || segment == ".." {
			return fmt.Errorf("%w: key contains a %q path segment", ErrInvalidKey, segment)
		}
	}
	return nil
}

// ValidateKeyPrefix validates a list-query prefix. Prefixes are deliberately
// laxer than object keys: an empty prefix means "list everything" and the
// SDK always sends prefixes ending in "/", so a trailing slash is allowed
// here where it is rejected for an object key.
func ValidateKeyPrefix(p string) error {
	if p == "" {
		return nil
	}
	if len(p) > 1024 {
		return fmt.Errorf("%w: prefix exceeds 1024 bytes", ErrInvalidKey)
	}
	if !utf8.ValidString(p) {
		return fmt.Errorf("%w: prefix is not valid UTF-8", ErrInvalidKey)
	}
	for _, r := range p {
		if r < 0x20 || r == 0x7f {
			return fmt.Errorf("%w: prefix contains a control character", ErrInvalidKey)
		}
	}
	if strings.HasPrefix(p, "/") {
		return fmt.Errorf("%w: prefix has a leading slash", ErrInvalidKey)
	}
	if strings.Contains(p, "//") {
		return fmt.Errorf("%w: prefix contains an empty path segment", ErrInvalidKey)
	}
	trimmed := strings.TrimSuffix(p, "/")
	for _, segment := range strings.Split(trimmed, "/") {
		if segment == "." || segment == ".." {
			return fmt.Errorf("%w: prefix contains a %q path segment", ErrInvalidKey, segment)
		}
	}
	return nil
}

func (r ObjectRef) ProjectID() string { return r.projectID }
func (r ObjectRef) Bucket() string    { return r.bucket }
func (r ObjectRef) Key() string       { return r.key }

// StorageKey returns the backend storage key for this ref. keyPrefix is
// omitted entirely from the result when empty.
func (r ObjectRef) StorageKey(keyPrefix string) string {
	if keyPrefix == "" {
		return fmt.Sprintf("p/%s/b/%s/o/%s", r.projectID, r.bucket, r.key)
	}
	return fmt.Sprintf("%s/p/%s/b/%s/o/%s", keyPrefix, r.projectID, r.bucket, r.key)
}

// BucketPrefix returns r's StorageKey truncated after "/o/", for use as a
// list prefix covering every object in the bucket.
func (r ObjectRef) BucketPrefix(keyPrefix string) string {
	if keyPrefix == "" {
		return fmt.Sprintf("p/%s/b/%s/o/", r.projectID, r.bucket)
	}
	return fmt.Sprintf("%s/p/%s/b/%s/o/", keyPrefix, r.projectID, r.bucket)
}
