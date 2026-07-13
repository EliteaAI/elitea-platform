package s3

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
)

// Config holds S3-specific configuration.
type Config struct {
	Endpoint       string
	AccessKey      string
	SecretKey      string
	Region         string
	ForcePathStyle bool
}

// Backend implements storage.Backend using S3-compatible APIs (AWS S3, MinIO).
// Bucket naming follows pylon convention: p--{projectID}.{bucketName}
type Backend struct {
	client *s3.Client
}

var _ storage.Backend = (*Backend)(nil)

// New creates an S3 Backend.
func New(ctx context.Context, cfg Config) (*Backend, error) {
	opts := []func(*awsconfig.LoadOptions) error{
		awsconfig.WithRegion(cfg.Region),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			cfg.AccessKey, cfg.SecretKey, "",
		)),
	}

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
	return &Backend{client: client}, nil
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
		if isErrType(err, &alreadyOwned) || isErrType(err, &alreadyExists) {
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
		b.client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
			Bucket: aws.String(name),
			Delete: &types.Delete{Objects: objs, Quiet: aws.Bool(true)},
		})
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

func isErrType[T error](err error, target *T) bool {
	return err != nil && strings.Contains(err.Error(), "BucketAlreadyOwnedByYou") ||
		strings.Contains(err.Error(), "BucketAlreadyExists")
}
