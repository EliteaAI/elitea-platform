package storage

import (
	"context"
	"io"
	"time"
)

// BucketInfo describes a named storage bucket.
type BucketInfo struct {
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
}

// ObjectInfo describes a stored object.
type ObjectInfo struct {
	Key          string    `json:"key"`
	Size         int64     `json:"size"`
	LastModified time.Time `json:"last_modified"`
	ContentType  string    `json:"content_type,omitempty"`
}

// Backend is the interface all storage backends must implement.
// Operations are scoped under (projectID, bucketName, key).
type Backend interface {
	ListBuckets(ctx context.Context, projectID string) ([]BucketInfo, error)
	CreateBucket(ctx context.Context, projectID, bucketName string) error
	DeleteBucket(ctx context.Context, projectID, bucketName string) error
	RenameBucket(ctx context.Context, projectID, oldName, newName string) error

	ListObjects(ctx context.Context, projectID, bucketName, prefix string) ([]ObjectInfo, error)
	PutObject(ctx context.Context, projectID, bucketName, key string, data io.Reader, size int64, contentType string) error
	GetObject(ctx context.Context, projectID, bucketName, key string) (io.ReadCloser, ObjectInfo, error)
	DeleteObject(ctx context.Context, projectID, bucketName, key string) error
	DeleteObjects(ctx context.Context, projectID, bucketName string, keys []string) error
	StatObject(ctx context.Context, projectID, bucketName, key string) (ObjectInfo, error)
}
