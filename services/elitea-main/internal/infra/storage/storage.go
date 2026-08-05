package storage

import (
	"time"
)

// ObjectInfo describes a stored object.
type ObjectInfo struct {
	Key          string    `json:"key"`
	Size         int64     `json:"size"`
	LastModified time.Time `json:"last_modified"`
	ContentType  string    `json:"content_type,omitempty"`
	ETag         string    `json:"etag,omitempty"`
	DigestSHA256 []byte    `json:"digest_sha256,omitempty"`
}
