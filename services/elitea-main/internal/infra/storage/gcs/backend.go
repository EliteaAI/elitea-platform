package gcs

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	gcstorage "cloud.google.com/go/storage"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
)

// Config holds GCS-specific configuration.
type Config struct {
	Bucket          string // single GCS bucket used as root
	CredentialsFile string // path to service account JSON

	// Endpoint overrides the default public GCS API host for reaching an
	// emulator (e.g. fake-gcs-server). It must be a full base URL including
	// the "/storage/v1/" path, for example "http://localhost:4443/storage/v1/"
	// — this is a complete base-URL override, not a host override, so a bare
	// host value silently routes every call to the wrong path and 404s on
	// every Stat, List, and Delete. Mutually exclusive with CredentialsFile.
	Endpoint string

	// KeyPrefix namespaces every ObjectStore key under Bucket; passed
	// through to ObjectRef.StorageKey/BucketPrefix. Optional, empty by
	// default.
	KeyPrefix string
}

// Backend implements storage.Backend using Google Cloud Storage.
// All objects live in a single GCS bucket with key prefix: {projectID}/{bucketName}/{key}
type Backend struct {
	client    *gcstorage.Client
	bucket    string
	keyPrefix string

	// hasSigningMaterial is true when New was given a service-account
	// credentials file, which BucketHandle.SignedURL can auto-detect a
	// signing key from. Ambient/ADC credentials (the CredentialsFile-empty
	// case) do not expose local signing material. Capabilities() reads this.
	hasSigningMaterial bool
}

var _ storage.Backend = (*Backend)(nil)
var _ storage.ObjectStore = (*Backend)(nil)

// clientOptions validates cfg and builds the client.ClientOption slice New
// passes to gcstorage.NewClient. Split out from New so the validation and
// option-selection logic can be tested without constructing a real client.
func clientOptions(cfg Config) ([]option.ClientOption, error) {
	if cfg.Endpoint != "" && cfg.CredentialsFile != "" {
		return nil, fmt.Errorf("storage/gcs: GCS_ENDPOINT and GOOGLE_APPLICATION_CREDENTIALS are mutually exclusive")
	}

	var opts []option.ClientOption
	switch {
	case cfg.CredentialsFile != "":
		opts = append(opts, option.WithCredentialsFile(cfg.CredentialsFile))
	case cfg.Endpoint != "":
		opts = append(opts, option.WithEndpoint(cfg.Endpoint), option.WithoutAuthentication())
	}
	return opts, nil
}

// New creates a GCS Backend.
func New(ctx context.Context, cfg Config) (*Backend, error) {
	opts, err := clientOptions(cfg)
	if err != nil {
		return nil, err
	}

	client, err := gcstorage.NewClient(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("storage/gcs: new client: %w", err)
	}
	return &Backend{
		client:             client,
		bucket:             cfg.Bucket,
		keyPrefix:          cfg.KeyPrefix,
		hasSigningMaterial: cfg.CredentialsFile != "",
	}, nil
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

// --- storage.ObjectStore ---
//
// The methods below operate against a single GCS bucket (b.bucket),
// namespaced by ObjectRef.StorageKey(b.keyPrefix). They coexist with the old
// Backend methods above, which keep their own {projectID}/{bucketName}/{key}
// object-name convention untouched.

func (b *Backend) Capabilities() storage.Capabilities {
	return storage.Capabilities{Presign: b.hasSigningMaterial, NativeMultipart: false, ServerSideCopy: true}
}

func (b *Backend) Put(ctx context.Context, ref storage.ObjectRef, body io.Reader, opts storage.PutOptions) (storage.ObjectInfo, error) {
	obj := b.client.Bucket(b.bucket).Object(ref.StorageKey(b.keyPrefix))
	w := obj.NewWriter(ctx)
	w.ChunkSize = 8 << 20
	if opts.ContentType != "" {
		w.ContentType = opts.ContentType
	}
	if len(opts.Metadata) > 0 {
		w.Metadata = opts.Metadata
	}
	if _, err := io.Copy(w, body); err != nil {
		_ = w.Close()
		return storage.ObjectInfo{}, fmt.Errorf("storage/gcs: put object: %w", err)
	}
	if err := w.Close(); err != nil {
		return storage.ObjectInfo{}, mapGCSError(err, "put object")
	}
	attrs := w.Attrs()
	return storage.ObjectInfo{
		Key:          ref.Key(),
		Size:         attrs.Size,
		LastModified: attrs.Updated,
		ContentType:  attrs.ContentType,
		ETag:         attrs.Etag,
	}, nil
}

// Get issues a single call — NewRangeReader when rng != nil, NewReader
// otherwise — and reads attributes off the reader itself rather than a
// separate Attrs call, avoiding a TOCTOU window. ObjectInfo.ETag is
// deliberately empty on this path: ReaderObjectAttrs carries no ETag. Only
// Stat and List populate it, from ObjectAttrs.Etag.
func (b *Backend) Get(ctx context.Context, ref storage.ObjectRef, rng *storage.ByteRange) (io.ReadCloser, storage.ObjectInfo, error) {
	obj := b.client.Bucket(b.bucket).Object(ref.StorageKey(b.keyPrefix))

	var reader *gcstorage.Reader
	var err error
	if rng != nil {
		length := int64(-1)
		if rng.End >= 0 {
			length = rng.End - rng.Start + 1
		}
		reader, err = obj.NewRangeReader(ctx, rng.Start, length)
	} else {
		reader, err = obj.NewReader(ctx)
	}
	if err != nil {
		return nil, storage.ObjectInfo{}, mapGCSError(err, "get object")
	}

	info := storage.ObjectInfo{
		Key:          ref.Key(),
		Size:         reader.Attrs.Size,
		LastModified: reader.Attrs.LastModified,
		ContentType:  reader.Attrs.ContentType,
	}
	return reader, info, nil
}

func (b *Backend) Stat(ctx context.Context, ref storage.ObjectRef) (storage.ObjectInfo, error) {
	obj := b.client.Bucket(b.bucket).Object(ref.StorageKey(b.keyPrefix))
	attrs, err := obj.Attrs(ctx)
	if err != nil {
		return storage.ObjectInfo{}, mapGCSError(err, "stat object")
	}
	return storage.ObjectInfo{
		Key:          ref.Key(),
		Size:         attrs.Size,
		LastModified: attrs.Updated,
		ContentType:  attrs.ContentType,
		ETag:         attrs.Etag,
	}, nil
}

// Delete explicitly checks for ErrObjectNotExist and returns nil — unlike
// S3, GCS returns an error for a missing key, so the interface's
// idempotency rule needs an explicit check here.
func (b *Backend) Delete(ctx context.Context, ref storage.ObjectRef) error {
	obj := b.client.Bucket(b.bucket).Object(ref.StorageKey(b.keyPrefix))
	if err := obj.Delete(ctx); err != nil {
		if errors.Is(err, gcstorage.ErrObjectNotExist) {
			return nil
		}
		return mapGCSError(err, "delete object")
	}
	return nil
}

// DeleteBatch has no bulk API in this client library — issue Delete calls
// sequentially and report each outcome individually.
func (b *Backend) DeleteBatch(ctx context.Context, refs []storage.ObjectRef) (storage.BatchResult, error) {
	var result storage.BatchResult
	for _, ref := range refs {
		if err := b.Delete(ctx, ref); err != nil {
			result.Failed = append(result.Failed, storage.BatchError{Key: ref.Key(), Err: err})
			continue
		}
		result.Deleted = append(result.Deleted, ref.Key())
	}
	return result, nil
}

func (b *Backend) List(ctx context.Context, q storage.ListQuery) (storage.ListPage, error) {
	if err := storage.ValidateKeyPrefix(q.KeyPrefix); err != nil {
		return storage.ListPage{}, err
	}
	basePrefix := q.Bucket.BucketPrefix(b.keyPrefix)

	pageSize := int(q.MaxKeys)
	if pageSize <= 0 || pageSize > 1000 {
		pageSize = 1000
	}

	it := b.client.Bucket(b.bucket).Objects(ctx, &gcstorage.Query{
		Prefix:    basePrefix + q.KeyPrefix,
		Delimiter: q.Delimiter,
	})
	pager := iterator.NewPager(it, pageSize, q.ContinuationToken)

	var attrs []*gcstorage.ObjectAttrs
	nextPageToken, err := pager.NextPage(&attrs)
	if err != nil {
		return storage.ListPage{}, mapGCSError(err, "list objects")
	}

	page := storage.ListPage{
		NextContinuationToken: nextPageToken,
		IsTruncated:           nextPageToken != "",
	}
	for _, a := range attrs {
		// A Delimiter query interleaves real objects with "directory"
		// pseudo-entries in the same stream — a pseudo-entry carries Prefix
		// instead of Name, matching the old Backend's ListBuckets check.
		if a.Prefix != "" {
			page.CommonPrefixes = append(page.CommonPrefixes, strings.TrimPrefix(a.Prefix, basePrefix))
			continue
		}
		page.Objects = append(page.Objects, storage.ObjectInfo{
			Key:          strings.TrimPrefix(a.Name, basePrefix),
			Size:         a.Size,
			LastModified: a.Updated,
			ContentType:  a.ContentType,
			ETag:         a.Etag,
		})
	}
	return page, nil
}

func (b *Backend) PresignGet(ctx context.Context, ref storage.ObjectRef, ttl time.Duration) (string, error) {
	if !b.hasSigningMaterial {
		return "", storage.ErrNotSupported
	}
	signedURL, err := b.client.Bucket(b.bucket).SignedURL(ref.StorageKey(b.keyPrefix), &gcstorage.SignedURLOptions{
		Method:  http.MethodGet,
		Expires: time.Now().Add(ttl),
	})
	if err != nil {
		return "", fmt.Errorf("storage/gcs: presign get: %w", err)
	}
	return signedURL, nil
}

// PresignPut's opts.ContentType is intentionally not passed to
// SignedURLOptions.ContentType: doing so would require every subsequent PUT
// to send back that exact Content-Type header or fail signature validation,
// which is a stricter contract than S3/Azure's presigned PUT (S15 verifies
// media type on commit instead, uniformly across all three backends).
func (b *Backend) PresignPut(ctx context.Context, ref storage.ObjectRef, ttl time.Duration, opts storage.PutOptions) (string, error) {
	if !b.hasSigningMaterial {
		return "", storage.ErrNotSupported
	}
	signedURL, err := b.client.Bucket(b.bucket).SignedURL(ref.StorageKey(b.keyPrefix), &gcstorage.SignedURLOptions{
		Method:  http.MethodPut,
		Expires: time.Now().Add(ttl),
	})
	if err != nil {
		return "", fmt.Errorf("storage/gcs: presign put: %w", err)
	}
	return signedURL, nil
}

// The four multipart methods return ErrNotSupported. The pinned client
// library has no multipart upload API: no upload identifier, no part list,
// no per-part signing. Do not attempt to emulate one.

func (b *Backend) StartMultipart(ctx context.Context, ref storage.ObjectRef, opts storage.PutOptions) (storage.UploadID, error) {
	return "", storage.ErrNotSupported
}

func (b *Backend) PresignPart(ctx context.Context, ref storage.ObjectRef, id storage.UploadID, part int32, ttl time.Duration) (string, error) {
	return "", storage.ErrNotSupported
}

func (b *Backend) CompleteMultipart(ctx context.Context, ref storage.ObjectRef, id storage.UploadID, parts []storage.Part) (storage.ObjectInfo, error) {
	return storage.ObjectInfo{}, storage.ErrNotSupported
}

func (b *Backend) AbortMultipart(ctx context.Context, ref storage.ObjectRef, id storage.UploadID) error {
	return storage.ErrNotSupported
}

// mapGCSError maps ErrObjectNotExist/ErrBucketNotExist to storage.ErrNotFound,
// wrapping the original error so errors.Is still finds it.
func mapGCSError(err error, op string) error {
	if errors.Is(err, gcstorage.ErrObjectNotExist) || errors.Is(err, gcstorage.ErrBucketNotExist) {
		return fmt.Errorf("storage/gcs: %s: %w", op, storage.ErrNotFound)
	}
	return fmt.Errorf("storage/gcs: %s: %w", op, err)
}
