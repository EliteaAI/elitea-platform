package storage

import (
	"time"
)

// ObjectInfo describes a stored object.
//
// Size and TotalSize differ only on a ranged Get. Size is always the number
// of bytes the returned reader yields, so it is what a caller may declare as
// Content-Length. TotalSize is the size of the whole object, which RFC 7233
// requires in the Content-Range header of a 206 response. A backend that
// cannot report the whole size leaves TotalSize at 0.
type ObjectInfo struct {
	Key          string    `json:"key"`
	Size         int64     `json:"size"`
	TotalSize    int64     `json:"total_size,omitempty"`
	LastModified time.Time `json:"last_modified"`
	ContentType  string    `json:"content_type,omitempty"`
	ETag         string    `json:"etag,omitempty"`
	DigestSHA256 []byte    `json:"digest_sha256,omitempty"`
}
