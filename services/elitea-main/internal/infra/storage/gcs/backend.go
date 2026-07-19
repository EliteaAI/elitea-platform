package gcs

import (
	"context"
	"fmt"
	"io"
	"strings"

	gcstorage "cloud.google.com/go/storage"
	"google.golang.org/api/iterator"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
)

// Config holds GCS-specific configuration.
type Config struct {
	Bucket          string // single GCS bucket used as root
	CredentialsFile string // path to service account JSON
}

// Backend implements storage.Backend using Google Cloud Storage.
// All objects live in a single GCS bucket with key prefix: {projectID}/{bucketName}/{key}
type Backend struct {
	client *gcstorage.Client
	bucket string
}

var _ storage.Backend = (*Backend)(nil)

// New creates a GCS Backend.
func New(ctx context.Context, cfg Config) (*Backend, error) {
	client, err := gcstorage.NewClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("storage/gcs: new client: %w", err)
	}
	return &Backend{client: client, bucket: cfg.Bucket}, nil
}

func (b *Backend) prefix(projectID, bucketName string) string {
	return projectID + "/" + bucketName + "/"
}

func (b *Backend) objectName(projectID, bucketName, key string) string {
	return projectID + "/" + bucketName + "/" + key
}

func (b *Backend) ListBuckets(ctx context.Context, projectID string) ([]storage.BucketInfo, error) {
	prefix := projectID + "/"
	it := b.client.Bucket(b.bucket).Objects(ctx, &gcstorage.Query{
		Prefix:    prefix,
		Delimiter: "/",
	})

	seen := map[string]bool{}
	var buckets []storage.BucketInfo
	for {
		attrs, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("storage/gcs: list buckets: %w", err)
		}
		// Prefixes represent "subdirectories" = buckets
		if attrs.Prefix != "" {
			name := strings.TrimPrefix(attrs.Prefix, prefix)
			name = strings.TrimSuffix(name, "/")
			if name != "" && !seen[name] {
				seen[name] = true
				buckets = append(buckets, storage.BucketInfo{Name: name})
			}
		}
	}
	return buckets, nil
}

func (b *Backend) CreateBucket(_ context.Context, _, _ string) error {
	// GCS doesn't have sub-buckets; creating an object with the prefix is sufficient
	return nil
}

func (b *Backend) DeleteBucket(ctx context.Context, projectID, bucketName string) error {
	prefix := b.prefix(projectID, bucketName)
	it := b.client.Bucket(b.bucket).Objects(ctx, &gcstorage.Query{Prefix: prefix})
	for {
		attrs, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return fmt.Errorf("storage/gcs: delete bucket list: %w", err)
		}
		if err := b.client.Bucket(b.bucket).Object(attrs.Name).Delete(ctx); err != nil {
			return fmt.Errorf("storage/gcs: delete bucket obj: %w", err)
		}
	}
	return nil
}

func (b *Backend) RenameBucket(ctx context.Context, projectID, oldName, newName string) error {
	oldPrefix := b.prefix(projectID, oldName)
	newPrefix := b.prefix(projectID, newName)

	it := b.client.Bucket(b.bucket).Objects(ctx, &gcstorage.Query{Prefix: oldPrefix})
	for {
		attrs, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return fmt.Errorf("storage/gcs: rename list: %w", err)
		}
		newKey := newPrefix + strings.TrimPrefix(attrs.Name, oldPrefix)
		src := b.client.Bucket(b.bucket).Object(attrs.Name)
		dst := b.client.Bucket(b.bucket).Object(newKey)
		if _, err := dst.CopierFrom(src).Run(ctx); err != nil {
			return fmt.Errorf("storage/gcs: rename copy: %w", err)
		}
		if err := src.Delete(ctx); err != nil {
			return fmt.Errorf("storage/gcs: rename delete old: %w", err)
		}
	}
	return nil
}

func (b *Backend) ListObjects(ctx context.Context, projectID, bucketName, objPrefix string) ([]storage.ObjectInfo, error) {
	prefix := b.prefix(projectID, bucketName) + objPrefix
	it := b.client.Bucket(b.bucket).Objects(ctx, &gcstorage.Query{Prefix: prefix})

	basePrefix := b.prefix(projectID, bucketName)
	var objects []storage.ObjectInfo
	for {
		attrs, err := it.Next()
		if err == iterator.Done {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("storage/gcs: list objects: %w", err)
		}
		objects = append(objects, storage.ObjectInfo{
			Key:          strings.TrimPrefix(attrs.Name, basePrefix),
			Size:         attrs.Size,
			LastModified: attrs.Updated,
			ContentType:  attrs.ContentType,
		})
	}
	return objects, nil
}

func (b *Backend) PutObject(ctx context.Context, projectID, bucketName, key string, data io.Reader, _ int64, contentType string) error {
	obj := b.client.Bucket(b.bucket).Object(b.objectName(projectID, bucketName, key))
	w := obj.NewWriter(ctx)
	if contentType != "" {
		w.ContentType = contentType
	}
	if _, err := io.Copy(w, data); err != nil {
		_ = w.Close()
		return fmt.Errorf("storage/gcs: put object: %w", err)
	}
	return w.Close()
}

func (b *Backend) GetObject(ctx context.Context, projectID, bucketName, key string) (io.ReadCloser, storage.ObjectInfo, error) {
	obj := b.client.Bucket(b.bucket).Object(b.objectName(projectID, bucketName, key))
	attrs, err := obj.Attrs(ctx)
	if err != nil {
		return nil, storage.ObjectInfo{}, fmt.Errorf("storage/gcs: get object attrs: %w", err)
	}
	reader, err := obj.NewReader(ctx)
	if err != nil {
		return nil, storage.ObjectInfo{}, fmt.Errorf("storage/gcs: get object reader: %w", err)
	}
	return reader, storage.ObjectInfo{
		Key:          key,
		Size:         attrs.Size,
		LastModified: attrs.Updated,
		ContentType:  attrs.ContentType,
	}, nil
}

func (b *Backend) DeleteObject(ctx context.Context, projectID, bucketName, key string) error {
	obj := b.client.Bucket(b.bucket).Object(b.objectName(projectID, bucketName, key))
	if err := obj.Delete(ctx); err != nil {
		return fmt.Errorf("storage/gcs: delete object: %w", err)
	}
	return nil
}

func (b *Backend) DeleteObjects(ctx context.Context, projectID, bucketName string, keys []string) error {
	for _, key := range keys {
		if err := b.DeleteObject(ctx, projectID, bucketName, key); err != nil {
			return err
		}
	}
	return nil
}

func (b *Backend) StatObject(ctx context.Context, projectID, bucketName, key string) (storage.ObjectInfo, error) {
	obj := b.client.Bucket(b.bucket).Object(b.objectName(projectID, bucketName, key))
	attrs, err := obj.Attrs(ctx)
	if err != nil {
		return storage.ObjectInfo{}, fmt.Errorf("storage/gcs: stat object: %w", err)
	}
	return storage.ObjectInfo{
		Key:          key,
		Size:         attrs.Size,
		LastModified: attrs.Updated,
		ContentType:  attrs.ContentType,
	}, nil
}
