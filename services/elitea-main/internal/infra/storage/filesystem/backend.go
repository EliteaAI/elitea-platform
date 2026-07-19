package filesystem

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
)

// Backend implements storage.Backend using the local filesystem.
// Layout: {dataDir}/{projectID}/{bucketName}/{key}
type Backend struct {
	dataDir string
}

var _ storage.Backend = (*Backend)(nil)

// New creates a filesystem Backend rooted at dataDir.
func New(dataDir string) *Backend {
	return &Backend{dataDir: dataDir}
}

func (b *Backend) bucketPath(projectID, bucketName string) string {
	return filepath.Join(b.dataDir, projectID, bucketName)
}

func (b *Backend) objectPath(projectID, bucketName, key string) string {
	return filepath.Join(b.dataDir, projectID, bucketName, key)
}

func (b *Backend) ListBuckets(_ context.Context, projectID string) ([]storage.BucketInfo, error) {
	dir := filepath.Join(b.dataDir, projectID)
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("storage/filesystem: list buckets: %w", err)
	}

	var buckets []storage.BucketInfo
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		info, _ := e.Info()
		bi := storage.BucketInfo{Name: e.Name()}
		if info != nil {
			bi.CreatedAt = info.ModTime()
		}
		buckets = append(buckets, bi)
	}
	return buckets, nil
}

func (b *Backend) CreateBucket(_ context.Context, projectID, bucketName string) error {
	return os.MkdirAll(b.bucketPath(projectID, bucketName), 0o755)
}

func (b *Backend) DeleteBucket(_ context.Context, projectID, bucketName string) error {
	return os.RemoveAll(b.bucketPath(projectID, bucketName))
}

func (b *Backend) RenameBucket(_ context.Context, projectID, oldName, newName string) error {
	return os.Rename(b.bucketPath(projectID, oldName), b.bucketPath(projectID, newName))
}

func (b *Backend) ListObjects(_ context.Context, projectID, bucketName, prefix string) ([]storage.ObjectInfo, error) {
	root := b.bucketPath(projectID, bucketName)
	var objects []storage.ObjectInfo

	err := filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			return nil
		}
		rel, _ := filepath.Rel(root, path)
		rel = filepath.ToSlash(rel)

		if prefix != "" && !strings.HasPrefix(rel, prefix) {
			return nil
		}

		info, err := d.Info()
		if err != nil {
			return nil
		}
		objects = append(objects, storage.ObjectInfo{
			Key:          rel,
			Size:         info.Size(),
			LastModified: info.ModTime(),
		})
		return nil
	})
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("storage/filesystem: list objects: %w", err)
	}
	return objects, nil
}

func (b *Backend) PutObject(_ context.Context, projectID, bucketName, key string, data io.Reader, _ int64, _ string) error {
	p := b.objectPath(projectID, bucketName, key)
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return fmt.Errorf("storage/filesystem: put object mkdir: %w", err)
	}
	f, err := os.Create(p)
	if err != nil {
		return fmt.Errorf("storage/filesystem: put object create: %w", err)
	}
	defer func() { _ = f.Close() }()
	if _, err := io.Copy(f, data); err != nil {
		return fmt.Errorf("storage/filesystem: put object write: %w", err)
	}
	return nil
}

func (b *Backend) GetObject(_ context.Context, projectID, bucketName, key string) (io.ReadCloser, storage.ObjectInfo, error) {
	p := b.objectPath(projectID, bucketName, key)
	f, err := os.Open(p)
	if err != nil {
		return nil, storage.ObjectInfo{}, fmt.Errorf("storage/filesystem: get object: %w", err)
	}
	info, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return nil, storage.ObjectInfo{}, fmt.Errorf("storage/filesystem: get object stat: %w", err)
	}
	return f, storage.ObjectInfo{
		Key:          key,
		Size:         info.Size(),
		LastModified: info.ModTime(),
	}, nil
}

func (b *Backend) DeleteObject(_ context.Context, projectID, bucketName, key string) error {
	return os.Remove(b.objectPath(projectID, bucketName, key))
}

func (b *Backend) DeleteObjects(_ context.Context, projectID, bucketName string, keys []string) error {
	var firstErr error
	for _, key := range keys {
		if err := os.Remove(b.objectPath(projectID, bucketName, key)); err != nil && !os.IsNotExist(err) {
			if firstErr == nil {
				firstErr = err
			}
		}
	}
	return firstErr
}

func (b *Backend) StatObject(_ context.Context, projectID, bucketName, key string) (storage.ObjectInfo, error) {
	info, err := os.Stat(b.objectPath(projectID, bucketName, key))
	if err != nil {
		return storage.ObjectInfo{}, fmt.Errorf("storage/filesystem: stat: %w", err)
	}
	return storage.ObjectInfo{
		Key:          key,
		Size:         info.Size(),
		LastModified: info.ModTime(),
	}, nil
}
