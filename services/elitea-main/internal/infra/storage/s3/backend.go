package s3

import (
	"context"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	smithy "github.com/aws/smithy-go"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
)

// Config holds S3-specific configuration.
type Config struct {
	Endpoint       string
	AccessKey      string
	SecretKey      string
	Region         string
	ForcePathStyle bool

	// Bucket is the single physical S3 bucket the ObjectStore methods
	// operate against. Distinct from the old Backend's per-(project,bucket)
	// physical-bucket convention (see bucketName below), which the new
	// interface replaces with key-prefix multiplexing inside one bucket via
	// ObjectRef.StorageKey.
	Bucket string

	// KeyPrefix namespaces every ObjectStore key under Bucket; passed
	// through to ObjectRef.StorageKey/BucketPrefix. Optional, empty by
	// default.
	KeyPrefix string
}

// Backend implements storage.Backend using S3-compatible APIs (AWS S3, MinIO,
// RustFS). The old Backend methods bucket per (project, bucket) with naming
// p--{projectID}.{bucketName}; the new ObjectStore methods share one bucket
// (Config.Bucket) with objects namespaced by ObjectRef.StorageKey.
type Backend struct {
	client *s3.Client

	bucket    string
	keyPrefix string
}

var _ storage.Backend = (*Backend)(nil)
var _ storage.ObjectStore = (*Backend)(nil)

// New creates an S3 Backend.
func New(ctx context.Context, cfg Config) (*Backend, error) {
	opts := []func(*awsconfig.LoadOptions) error{
		awsconfig.WithRegion(cfg.Region),
	}
	if cfg.AccessKey != "" {
		opts = append(opts, awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			cfg.AccessKey, cfg.SecretKey, "",
		)))
	}
	// When AccessKey is empty, do not force static (empty) credentials —
	// let LoadDefaultConfig resolve IRSA, instance, and environment
	// credentials instead.

	awsCfg, err := awsconfig.LoadDefaultConfig(ctx, opts...)
	if err != nil {
		return nil, fmt.Errorf("storage/s3: load config: %w", err)
	}

	clientOpts := []func(*s3.Options){}
	if cfg.Endpoint != "" {
		clientOpts = append(clientOpts, func(o *s3.Options) {
			o.BaseEndpoint = aws.String(cfg.Endpoint)
			o.UsePathStyle = cfg.ForcePathStyle
		})
	}

	client := s3.NewFromConfig(awsCfg, clientOpts...)
	return &Backend{client: client, bucket: cfg.Bucket, keyPrefix: cfg.KeyPrefix}, nil
}

func bucketName(projectID, bucket string) string {
	return fmt.Sprintf("p--%s.%s", projectID, bucket)
}

func (b *Backend) ListBuckets(ctx context.Context, projectID string) ([]storage.BucketInfo, error) {
	prefix := fmt.Sprintf("p--%s.", projectID)
	out, err := b.client.ListBuckets(ctx, &s3.ListBucketsInput{})
	if err != nil {
		return nil, fmt.Errorf("storage/s3: list buckets: %w", err)
	}

	var buckets []storage.BucketInfo
	for _, bkt := range out.Buckets {
		name := aws.ToString(bkt.Name)
		if !strings.HasPrefix(name, prefix) {
			continue
		}
		buckets = append(buckets, storage.BucketInfo{
			Name:      strings.TrimPrefix(name, prefix),
			CreatedAt: aws.ToTime(bkt.CreationDate),
		})
	}
	return buckets, nil
}

func (b *Backend) CreateBucket(ctx context.Context, projectID, bktName string) error {
	_, err := b.client.CreateBucket(ctx, &s3.CreateBucketInput{
		Bucket: aws.String(bucketName(projectID, bktName)),
	})
	if err != nil {
		var alreadyOwned *types.BucketAlreadyOwnedByYou
		var alreadyExists *types.BucketAlreadyExists
		if errors.As(err, &alreadyOwned) || errors.As(err, &alreadyExists) {
			return nil
		}
		return fmt.Errorf("storage/s3: create bucket: %w", err)
	}
	return nil
}

func (b *Backend) DeleteBucket(ctx context.Context, projectID, bktName string) error {
	name := bucketName(projectID, bktName)
	// Delete all objects first (S3 requires empty bucket)
	paginator := s3.NewListObjectsV2Paginator(b.client, &s3.ListObjectsV2Input{
		Bucket: aws.String(name),
	})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			break
		}
		if len(page.Contents) == 0 {
			continue
		}
		var objs []types.ObjectIdentifier
		for _, obj := range page.Contents {
			objs = append(objs, types.ObjectIdentifier{Key: obj.Key})
		}
		if _, err := b.client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: aws.String(name),
			Delete: &types.Delete{Objects: objs, Quiet: aws.Bool(true)},
		}); err != nil {
			return fmt.Errorf("storage/s3: delete bucket objects: %w", err)
		}
	}

	_, err := b.client.DeleteBucket(ctx, &s3.DeleteBucketInput{
		Bucket: aws.String(name),
	})
	if err != nil {
		return fmt.Errorf("storage/s3: delete bucket: %w", err)
	}
	return nil
}

func (b *Backend) RenameBucket(ctx context.Context, projectID, oldName, newName string) error {
	src := bucketName(projectID, oldName)
	dst := bucketName(projectID, newName)

	if err := b.CreateBucket(ctx, projectID, newName); err != nil {
		return err
	}

	// Copy all objects
	paginator := s3.NewListObjectsV2Paginator(b.client, &s3.ListObjectsV2Input{
		Bucket: aws.String(src),
	})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return fmt.Errorf("storage/s3: rename list: %w", err)
		}
		for _, obj := range page.Contents {
			_, err := b.client.CopyObject(ctx, &s3.CopyObjectInput{
				Bucket:     aws.String(dst),
				CopySource: aws.String(src + "/" + aws.ToString(obj.Key)),
				Key:        obj.Key,
			})
			if err != nil {
				return fmt.Errorf("storage/s3: rename copy: %w", err)
			}
		}
	}

	// Delete old bucket
	return b.DeleteBucket(ctx, projectID, oldName)
}

func (b *Backend) ListObjects(ctx context.Context, projectID, bktName, prefix string) ([]storage.ObjectInfo, error) {
	input := &s3.ListObjectsV2Input{
		Bucket: aws.String(bucketName(projectID, bktName)),
	}
	if prefix != "" {
		input.Prefix = aws.String(prefix)
	}

	var objects []storage.ObjectInfo
	paginator := s3.NewListObjectsV2Paginator(b.client, input)
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("storage/s3: list objects: %w", err)
		}
		for _, obj := range page.Contents {
			objects = append(objects, storage.ObjectInfo{
				Key:          aws.ToString(obj.Key),
				Size:         aws.ToInt64(obj.Size),
				LastModified: aws.ToTime(obj.LastModified),
			})
		}
	}
	return objects, nil
}

func (b *Backend) PutObject(ctx context.Context, projectID, bktName, key string, data io.Reader, size int64, contentType string) error {
	input := &s3.PutObjectInput{
		Bucket: aws.String(bucketName(projectID, bktName)),
		Key:    aws.String(key),
		Body:   data,
	}
	if size > 0 {
		input.ContentLength = aws.Int64(size)
	}
	if contentType != "" {
		input.ContentType = aws.String(contentType)
	}

	_, err := b.client.PutObject(ctx, input)
	if err != nil {
		return fmt.Errorf("storage/s3: put object: %w", err)
	}
	return nil
}

func (b *Backend) GetObject(ctx context.Context, projectID, bktName, key string) (io.ReadCloser, storage.ObjectInfo, error) {
	out, err := b.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(bucketName(projectID, bktName)),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, storage.ObjectInfo{}, fmt.Errorf("storage/s3: get object: %w", err)
	}
	info := storage.ObjectInfo{
		Key:          key,
		Size:         aws.ToInt64(out.ContentLength),
		LastModified: aws.ToTime(out.LastModified),
		ContentType:  aws.ToString(out.ContentType),
	}
	return out.Body, info, nil
}

func (b *Backend) DeleteObject(ctx context.Context, projectID, bktName, key string) error {
	_, err := b.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(bucketName(projectID, bktName)),
		Key:    aws.String(key),
	})
	if err != nil {
		return fmt.Errorf("storage/s3: delete object: %w", err)
	}
	return nil
}

func (b *Backend) DeleteObjects(ctx context.Context, projectID, bktName string, keys []string) error {
	if len(keys) == 0 {
		return nil
	}
	var objs []types.ObjectIdentifier
	for _, k := range keys {
		objs = append(objs, types.ObjectIdentifier{Key: aws.String(k)})
	}
	_, err := b.client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
		Bucket: aws.String(bucketName(projectID, bktName)),
		Delete: &types.Delete{Objects: objs, Quiet: aws.Bool(true)},
	})
	if err != nil {
		return fmt.Errorf("storage/s3: delete objects: %w", err)
	}
	return nil
}

func (b *Backend) StatObject(ctx context.Context, projectID, bktName, key string) (storage.ObjectInfo, error) {
	out, err := b.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(bucketName(projectID, bktName)),
		Key:    aws.String(key),
	})
	if err != nil {
		return storage.ObjectInfo{}, fmt.Errorf("storage/s3: stat object: %w", err)
	}
	return storage.ObjectInfo{
		Key:          key,
		Size:         aws.ToInt64(out.ContentLength),
		LastModified: aws.ToTime(out.LastModified),
		ContentType:  aws.ToString(out.ContentType),
	}, nil
}

// --- storage.ObjectStore ---
//
// The methods below operate against a single physical bucket (b.bucket),
// namespaced by ObjectRef.StorageKey(b.keyPrefix). They coexist with the old
// Backend methods above, which keep their own per-(project,bucket)-bucket
// convention untouched.

func (b *Backend) Capabilities() storage.Capabilities {
	return storage.Capabilities{Presign: true, NativeMultipart: true, ServerSideCopy: true}
}

func (b *Backend) Put(ctx context.Context, ref storage.ObjectRef, body io.Reader, opts storage.PutOptions) (storage.ObjectInfo, error) {
	key := ref.StorageKey(b.keyPrefix)

	if seeker, ok := body.(io.ReadSeeker); ok {
		size := opts.ContentLength
		if size < 0 {
			var err error
			size, err = seekableSize(seeker)
			if err != nil {
				return storage.ObjectInfo{}, fmt.Errorf("storage/s3: measure seekable body: %w", err)
			}
		}
		input := &s3.PutObjectInput{
			Bucket:        aws.String(b.bucket),
			Key:           aws.String(key),
			Body:          seeker,
			ContentLength: aws.Int64(size),
		}
		if opts.ContentType != "" {
			input.ContentType = aws.String(opts.ContentType)
		}
		if len(opts.Metadata) > 0 {
			input.Metadata = opts.Metadata
		}
		out, err := b.client.PutObject(ctx, input)
		if err != nil {
			return storage.ObjectInfo{}, mapS3Error(err, "put object")
		}
		return storage.ObjectInfo{
			Key:         ref.Key(),
			Size:        size,
			ContentType: opts.ContentType,
			ETag:        strings.Trim(aws.ToString(out.ETag), `"`),
		}, nil
	}

	// Non-seekable bodies (S9 passes a *multipart.Part) fail SigV4's
	// RewindStream before the request reaches the network, over plain HTTP —
	// route them through the multipart uploader instead of PutObject.
	input := &s3.PutObjectInput{
		Bucket: aws.String(b.bucket),
		Key:    aws.String(key),
		Body:   body,
	}
	if opts.ContentType != "" {
		input.ContentType = aws.String(opts.ContentType)
	}
	if len(opts.Metadata) > 0 {
		input.Metadata = opts.Metadata
	}
	out, err := manager.NewUploader(b.client).Upload(ctx, input)
	if err != nil {
		return storage.ObjectInfo{}, mapS3Error(err, "upload object")
	}
	return storage.ObjectInfo{
		Key:         ref.Key(),
		ContentType: opts.ContentType,
		ETag:        strings.Trim(aws.ToString(out.ETag), `"`),
	}, nil
}

func seekableSize(s io.ReadSeeker) (int64, error) {
	current, err := s.Seek(0, io.SeekCurrent)
	if err != nil {
		return 0, err
	}
	end, err := s.Seek(0, io.SeekEnd)
	if err != nil {
		return 0, err
	}
	if _, err := s.Seek(current, io.SeekStart); err != nil {
		return 0, err
	}
	return end - current, nil
}

func (b *Backend) Get(ctx context.Context, ref storage.ObjectRef, rng *storage.ByteRange) (io.ReadCloser, storage.ObjectInfo, error) {
	input := &s3.GetObjectInput{
		Bucket: aws.String(b.bucket),
		Key:    aws.String(ref.StorageKey(b.keyPrefix)),
	}
	if rng != nil {
		input.Range = aws.String(formatByteRange(*rng))
	}
	out, err := b.client.GetObject(ctx, input)
	if err != nil {
		return nil, storage.ObjectInfo{}, mapS3Error(err, "get object")
	}
	info := storage.ObjectInfo{
		Key:          ref.Key(),
		Size:         aws.ToInt64(out.ContentLength),
		LastModified: aws.ToTime(out.LastModified),
		ContentType:  aws.ToString(out.ContentType),
		ETag:         strings.Trim(aws.ToString(out.ETag), `"`),
	}
	return out.Body, info, nil
}

func formatByteRange(r storage.ByteRange) string {
	if r.End < 0 {
		return fmt.Sprintf("bytes=%d-", r.Start)
	}
	return fmt.Sprintf("bytes=%d-%d", r.Start, r.End)
}

func (b *Backend) Stat(ctx context.Context, ref storage.ObjectRef) (storage.ObjectInfo, error) {
	out, err := b.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(b.bucket),
		Key:    aws.String(ref.StorageKey(b.keyPrefix)),
	})
	if err != nil {
		return storage.ObjectInfo{}, mapS3Error(err, "stat object")
	}
	return storage.ObjectInfo{
		Key:          ref.Key(),
		Size:         aws.ToInt64(out.ContentLength),
		LastModified: aws.ToTime(out.LastModified),
		ContentType:  aws.ToString(out.ContentType),
		ETag:         strings.Trim(aws.ToString(out.ETag), `"`),
	}, nil
}

// Delete is idempotent: S3 does not error on deleting an already-absent key,
// so no special-case mapping is needed here (contrast the gcs backend).
func (b *Backend) Delete(ctx context.Context, ref storage.ObjectRef) error {
	_, err := b.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(b.bucket),
		Key:    aws.String(ref.StorageKey(b.keyPrefix)),
	})
	if err != nil {
		return mapS3Error(err, "delete object")
	}
	return nil
}

func (b *Backend) DeleteBatch(ctx context.Context, refs []storage.ObjectRef) (storage.BatchResult, error) {
	var result storage.BatchResult
	for start := 0; start < len(refs); start += 1000 {
		end := start + 1000
		if end > len(refs) {
			end = len(refs)
		}
		chunk := refs[start:end]

		objs := make([]types.ObjectIdentifier, len(chunk))
		keyByStorageKey := make(map[string]string, len(chunk))
		for i, ref := range chunk {
			storageKey := ref.StorageKey(b.keyPrefix)
			objs[i] = types.ObjectIdentifier{Key: aws.String(storageKey)}
			keyByStorageKey[storageKey] = ref.Key()
		}

		// Quiet is deliberately left nil (not set to false — *bool with
		// Quiet: false does not compile). Omitting it selects verbose mode,
		// which is what populates Deleted[] below.
		out, err := b.client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: aws.String(b.bucket),
			Delete: &types.Delete{Objects: objs},
		})
		if err != nil {
			return result, mapS3Error(err, "delete batch")
		}
		for _, d := range out.Deleted {
			result.Deleted = append(result.Deleted, keyByStorageKey[aws.ToString(d.Key)])
		}
		for _, e := range out.Errors {
			result.Failed = append(result.Failed, storage.BatchError{
				Key: keyByStorageKey[aws.ToString(e.Key)],
				Err: fmt.Errorf("storage/s3: %s: %s", aws.ToString(e.Code), aws.ToString(e.Message)),
			})
		}
	}
	return result, nil
}

func (b *Backend) List(ctx context.Context, q storage.ListQuery) (storage.ListPage, error) {
	if err := storage.ValidateKeyPrefix(q.KeyPrefix); err != nil {
		return storage.ListPage{}, err
	}

	basePrefix := q.Bucket.BucketPrefix(b.keyPrefix)
	input := &s3.ListObjectsV2Input{
		Bucket: aws.String(b.bucket),
		Prefix: aws.String(basePrefix + q.KeyPrefix),
	}
	if q.Delimiter != "" {
		input.Delimiter = aws.String(q.Delimiter)
	}
	if q.MaxKeys > 0 {
		maxKeys := q.MaxKeys
		if maxKeys > 1000 {
			maxKeys = 1000
		}
		input.MaxKeys = aws.Int32(maxKeys)
	}
	if q.ContinuationToken != "" {
		input.ContinuationToken = aws.String(q.ContinuationToken)
	}

	out, err := b.client.ListObjectsV2(ctx, input)
	if err != nil {
		return storage.ListPage{}, mapS3Error(err, "list objects")
	}

	page := storage.ListPage{
		IsTruncated:           aws.ToBool(out.IsTruncated),
		NextContinuationToken: aws.ToString(out.NextContinuationToken),
	}
	for _, obj := range out.Contents {
		page.Objects = append(page.Objects, storage.ObjectInfo{
			Key:          strings.TrimPrefix(aws.ToString(obj.Key), basePrefix),
			Size:         aws.ToInt64(obj.Size),
			LastModified: aws.ToTime(obj.LastModified),
			ETag:         strings.Trim(aws.ToString(obj.ETag), `"`),
		})
	}
	for _, cp := range out.CommonPrefixes {
		page.CommonPrefixes = append(page.CommonPrefixes, strings.TrimPrefix(aws.ToString(cp.Prefix), basePrefix))
	}
	return page, nil
}

func (b *Backend) PresignGet(ctx context.Context, ref storage.ObjectRef, ttl time.Duration) (string, error) {
	presigned, err := s3.NewPresignClient(b.client).PresignGetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(b.bucket),
		Key:    aws.String(ref.StorageKey(b.keyPrefix)),
	}, s3.WithPresignExpires(ttl))
	if err != nil {
		return "", fmt.Errorf("storage/s3: presign get: %w", err)
	}
	return presigned.URL, nil
}

// PresignPut's ContentType, when set, is not part of the signature — a
// presigned PUT does not enforce media type at the storage layer. S15
// verifies it on commit instead.
func (b *Backend) PresignPut(ctx context.Context, ref storage.ObjectRef, ttl time.Duration, opts storage.PutOptions) (string, error) {
	input := &s3.PutObjectInput{
		Bucket: aws.String(b.bucket),
		Key:    aws.String(ref.StorageKey(b.keyPrefix)),
	}
	if opts.ContentType != "" {
		input.ContentType = aws.String(opts.ContentType)
	}
	presigned, err := s3.NewPresignClient(b.client).PresignPutObject(ctx, input, s3.WithPresignExpires(ttl))
	if err != nil {
		return "", fmt.Errorf("storage/s3: presign put: %w", err)
	}
	return presigned.URL, nil
}

func (b *Backend) StartMultipart(ctx context.Context, ref storage.ObjectRef, opts storage.PutOptions) (storage.UploadID, error) {
	input := &s3.CreateMultipartUploadInput{
		Bucket: aws.String(b.bucket),
		Key:    aws.String(ref.StorageKey(b.keyPrefix)),
	}
	if opts.ContentType != "" {
		input.ContentType = aws.String(opts.ContentType)
	}
	out, err := b.client.CreateMultipartUpload(ctx, input)
	if err != nil {
		return "", fmt.Errorf("storage/s3: start multipart: %w", err)
	}
	return storage.UploadID(aws.ToString(out.UploadId)), nil
}

func (b *Backend) PresignPart(ctx context.Context, ref storage.ObjectRef, id storage.UploadID, part int32, ttl time.Duration) (string, error) {
	presigned, err := s3.NewPresignClient(b.client).PresignUploadPart(ctx, &s3.UploadPartInput{
		Bucket:     aws.String(b.bucket),
		Key:        aws.String(ref.StorageKey(b.keyPrefix)),
		UploadId:   aws.String(string(id)),
		PartNumber: aws.Int32(part),
	}, s3.WithPresignExpires(ttl))
	if err != nil {
		return "", fmt.Errorf("storage/s3: presign part: %w", err)
	}
	return presigned.URL, nil
}

// CompleteMultipart requires parts in strictly ascending PartNumber order —
// S3 (confirmed against real RustFS) rejects an out-of-order list with
// InvalidPartOrder. Callers are not required to pass parts pre-sorted.
func (b *Backend) CompleteMultipart(ctx context.Context, ref storage.ObjectRef, id storage.UploadID, parts []storage.Part) (storage.ObjectInfo, error) {
	sorted := append([]storage.Part(nil), parts...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Number < sorted[j].Number })

	completed := make([]types.CompletedPart, len(sorted))
	for i, p := range sorted {
		completed[i] = types.CompletedPart{
			ETag:       aws.String(quoteETag(p.ETag)),
			PartNumber: aws.Int32(p.Number),
		}
	}
	out, err := b.client.CompleteMultipartUpload(ctx, &s3.CompleteMultipartUploadInput{
		Bucket:          aws.String(b.bucket),
		Key:             aws.String(ref.StorageKey(b.keyPrefix)),
		UploadId:        aws.String(string(id)),
		MultipartUpload: &types.CompletedMultipartUpload{Parts: completed},
	})
	if err != nil {
		return storage.ObjectInfo{}, fmt.Errorf("storage/s3: complete multipart: %w", err)
	}
	return storage.ObjectInfo{
		Key:  ref.Key(),
		ETag: strings.Trim(aws.ToString(out.ETag), `"`),
	}, nil
}

func (b *Backend) AbortMultipart(ctx context.Context, ref storage.ObjectRef, id storage.UploadID) error {
	_, err := b.client.AbortMultipartUpload(ctx, &s3.AbortMultipartUploadInput{
		Bucket:   aws.String(b.bucket),
		Key:      aws.String(ref.StorageKey(b.keyPrefix)),
		UploadId: aws.String(string(id)),
	})
	if err != nil {
		return fmt.Errorf("storage/s3: abort multipart: %w", err)
	}
	return nil
}

// quoteETag ensures an ETag is wrapped in quotes, matching what
// CompleteMultipartUpload expects to receive back from a prior UploadPart
// response — S3 requires the exact quoted form.
func quoteETag(s string) string {
	if s == "" || strings.HasPrefix(s, `"`) {
		return s
	}
	return `"` + s + `"`
}

// mapS3Error maps NoSuchKey/NoSuchBucket and their smithy API-error-code
// equivalents to storage.ErrNotFound, and access-denied-shaped codes to
// storage.ErrAccessDenied, wrapping the original error in both cases so
// errors.Is still finds it.
func mapS3Error(err error, op string) error {
	var noSuchKey *types.NoSuchKey
	var noSuchBucket *types.NoSuchBucket
	if errors.As(err, &noSuchKey) || errors.As(err, &noSuchBucket) {
		return fmt.Errorf("storage/s3: %s: %w", op, storage.ErrNotFound)
	}
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		switch apiErr.ErrorCode() {
		case "NoSuchKey", "NoSuchBucket", "NotFound":
			return fmt.Errorf("storage/s3: %s: %w", op, storage.ErrNotFound)
		case "AccessDenied", "Forbidden", "AllAccessDisabled":
			return fmt.Errorf("storage/s3: %s: %w", op, storage.ErrAccessDenied)
		}
	}
	return fmt.Errorf("storage/s3: %s: %w", op, err)
}
