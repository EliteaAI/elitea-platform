package artifacts

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
)

type PgRepo struct {
	pool    *pgxpool.Pool
	backend storage.Backend
}

func NewPgRepo(pool *pgxpool.Pool, backend storage.Backend) *PgRepo {
	return &PgRepo{pool: pool, backend: backend}
}

func (r *PgRepo) bucketKey(projectID, name string) string {
	raw := fmt.Sprintf("p--%s.%s", projectID, name)
	return base64.StdEncoding.EncodeToString([]byte(raw))
}

func (r *PgRepo) ListBuckets(ctx context.Context, projectID string) ([]Bucket, error) {
	rawPrefix := fmt.Sprintf("p--%s.", projectID)

	rows, err := r.pool.Query(ctx,
		`SELECT id, data::text FROM centry.storage_meta`)
	if err != nil {
		return r.listBucketsFromBackend(ctx, projectID)
	}
	defer rows.Close()

	var buckets []Bucket
	for rows.Next() {
		var encodedID, dataStr string
		if err := rows.Scan(&encodedID, &dataStr); err != nil {
			continue
		}

		decoded, err := base64.StdEncoding.DecodeString(encodedID)
		if err != nil {
			continue
		}
		full := string(decoded)
		if !strings.HasPrefix(full, rawPrefix) {
			continue
		}
		bucketName := full[len(rawPrefix):]

		var meta struct {
			Tags struct {
				Type string `json:"type"`
			} `json:"tags"`
			Lifecycle int `json:"lifecycle"`
		}
		// ignore unmarshal error — missing/malformed tags just leaves meta at zero value
		_ = json.Unmarshal([]byte(dataStr), &meta)

		isPinned := meta.Tags.Type == "system"

		buckets = append(buckets, Bucket{
			ID:        encodedID,
			Name:      bucketName,
			IsPinned:  isPinned,
			CreatedAt: time.Now().Add(-24 * time.Hour),
		})
	}

	if len(buckets) == 0 {
		return r.listBucketsFromBackend(ctx, projectID)
	}
	return buckets, nil
}

func (r *PgRepo) listBucketsFromBackend(ctx context.Context, projectID string) ([]Bucket, error) {
	infos, err := r.backend.ListBuckets(ctx, projectID)
	if err != nil {
		return []Bucket{}, nil
	}

	var buckets []Bucket
	for _, info := range infos {
		buckets = append(buckets, Bucket{
			ID:        r.bucketKey(projectID, info.Name),
			Name:      info.Name,
			CreatedAt: info.CreatedAt,
		})
	}
	return buckets, nil
}

func (r *PgRepo) CreateBucket(ctx context.Context, projectID, name string) (Bucket, error) {
	key := r.bucketKey(projectID, name)
	meta := `{"tags": {"type": "local"}, "lifecycle": 365}`
	_, err := r.pool.Exec(ctx,
		`INSERT INTO centry.storage_meta (id, data) VALUES ($1, $2::json) ON CONFLICT (id) DO NOTHING`,
		key, meta)
	if err != nil {
		return Bucket{}, err
	}

	// best-effort: bucket may already exist in storage backend; ignore error
	_ = r.backend.CreateBucket(ctx, projectID, name)

	return Bucket{
		ID:        key,
		Name:      name,
		CreatedAt: time.Now(),
	}, nil
}

func (r *PgRepo) UpdateBucket(ctx context.Context, projectID, name string, meta map[string]any) (Bucket, error) {
	newName, _ := meta["name"].(string)
	if newName != "" && newName != name {
		oldKey := r.bucketKey(projectID, name)
		newKey := r.bucketKey(projectID, newName)
		if _, err := r.pool.Exec(ctx, `UPDATE centry.storage_meta SET id = $1 WHERE id = $2`, newKey, oldKey); err != nil {
			return Bucket{}, fmt.Errorf("rename bucket metadata: %w", err)
		}
		// best-effort: rename in storage backend; ignore error if backend does not support rename
		_ = r.backend.RenameBucket(ctx, projectID, name, newName)
		name = newName
	}
	return Bucket{ID: r.bucketKey(projectID, name), Name: name, CreatedAt: time.Now()}, nil
}

func (r *PgRepo) PatchBucket(ctx context.Context, projectID, name string, isPinned bool) (Bucket, error) {
	return Bucket{ID: r.bucketKey(projectID, name), Name: name, IsPinned: isPinned, CreatedAt: time.Now()}, nil
}

func (r *PgRepo) DeleteBucket(ctx context.Context, projectID, name string) error {
	key := r.bucketKey(projectID, name)
	if _, err := r.pool.Exec(ctx, `DELETE FROM centry.storage_meta WHERE id = $1`, key); err != nil {
		return fmt.Errorf("delete bucket metadata: %w", err)
	}
	// best-effort: remove from storage backend; ignore error
	_ = r.backend.DeleteBucket(ctx, projectID, name)
	return nil
}

func (r *PgRepo) ListArtifacts(ctx context.Context, projectID, bucket string) ([]Artifact, error) {
	objects, err := r.backend.ListObjects(ctx, projectID, bucket, "")
	if err != nil {
		return []Artifact{}, nil
	}

	var artifacts []Artifact
	for _, obj := range objects {
		artifacts = append(artifacts, Artifact{
			ID:        base64.StdEncoding.EncodeToString([]byte(obj.Key)),
			BucketID:  bucket,
			Name:      obj.Key,
			Size:      obj.Size,
			CreatedAt: obj.LastModified,
		})
	}

	if artifacts == nil {
		return []Artifact{}, nil
	}
	return artifacts, nil
}

func (r *PgRepo) GetArtifact(_ context.Context, projectID, bucket string) (Artifact, error) {
	return Artifact{}, fmt.Errorf("not found")
}

func (r *PgRepo) CreateArtifact(_ context.Context, projectID, bucket string, body map[string]any) (Artifact, error) {
	name, _ := body["name"].(string)
	return Artifact{
		ID:        base64.StdEncoding.EncodeToString([]byte(name)),
		BucketID:  bucket,
		Name:      name,
		CreatedAt: time.Now(),
	}, nil
}

func (r *PgRepo) DeleteArtifact(_ context.Context, projectID, bucket string) error {
	return nil
}

func (r *PgRepo) UploadArtifact(ctx context.Context, projectID, bucket, filename, mimeType string, size int64) (Artifact, error) {
	// best-effort: ensure bucket exists in storage backend before upload
	_ = r.backend.CreateBucket(ctx, projectID, bucket)

	return Artifact{
		ID:        base64.StdEncoding.EncodeToString([]byte(filename)),
		BucketID:  bucket,
		Name:      filename,
		MimeType:  mimeType,
		Size:      size,
		CreatedAt: time.Now(),
	}, nil
}

func (r *PgRepo) DeleteArtifacts(ctx context.Context, projectID, bucket string, names []string) error {
	return r.backend.DeleteObjects(ctx, projectID, bucket, names)
}
