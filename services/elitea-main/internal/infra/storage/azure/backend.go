package azure

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/Azure/azure-sdk-for-go/sdk/storage/azblob"
	"github.com/Azure/azure-sdk-for-go/sdk/storage/azblob/blob"
	"github.com/Azure/azure-sdk-for-go/sdk/storage/azblob/container"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
)

// Config holds Azure Blob-specific configuration.
type Config struct {
	Account       string
	Key           string
	ContainerName string // single container used as root
}

// Backend implements storage.Backend using Azure Blob Storage.
// All objects live in a single container with blob name: {projectID}/{bucketName}/{key}
type Backend struct {
	client        *azblob.Client
	containerName string
}

var _ storage.Backend = (*Backend)(nil)

// New creates an Azure Blob Backend.
func New(_ context.Context, cfg Config) (*Backend, error) {
	cred, err := azblob.NewSharedKeyCredential(cfg.Account, cfg.Key)
	if err != nil {
		return nil, fmt.Errorf("storage/azure: credential: %w", err)
	}
	serviceURL := fmt.Sprintf("https://%s.blob.core.windows.net/", cfg.Account)
	client, err := azblob.NewClientWithSharedKeyCredential(serviceURL, cred, nil)
	if err != nil {
		return nil, fmt.Errorf("storage/azure: client: %w", err)
	}
	return &Backend{client: client, containerName: cfg.ContainerName}, nil
}

func (b *Backend) prefix(projectID, bucketName string) string {
	return projectID + "/" + bucketName + "/"
}

func (b *Backend) blobName(projectID, bucketName, key string) string {
	return projectID + "/" + bucketName + "/" + key
}

func (b *Backend) containerClient() *container.Client {
	return b.client.ServiceClient().NewContainerClient(b.containerName)
}

func (b *Backend) ListBuckets(ctx context.Context, projectID string) ([]storage.BucketInfo, error) {
	prefix := projectID + "/"
	delimiter := "/"
	pager := b.containerClient().NewListBlobsHierarchyPager(delimiter, &container.ListBlobsHierarchyOptions{
		Prefix: &prefix,
	})

	var buckets []storage.BucketInfo
	for pager.More() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("storage/azure: list buckets: %w", err)
		}
		for _, blobPrefix := range page.Segment.BlobPrefixes {
			name := strings.TrimPrefix(*blobPrefix.Name, prefix)
			name = strings.TrimSuffix(name, "/")
			if name != "" {
				buckets = append(buckets, storage.BucketInfo{Name: name})
			}
		}
	}
	return buckets, nil
}

func (b *Backend) CreateBucket(_ context.Context, _, _ string) error {
	return nil
}

func (b *Backend) DeleteBucket(ctx context.Context, projectID, bucketName string) error {
	prefix := b.prefix(projectID, bucketName)
	pager := b.containerClient().NewListBlobsFlatPager(&container.ListBlobsFlatOptions{
		Prefix: &prefix,
	})
	for pager.More() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return fmt.Errorf("storage/azure: delete bucket list: %w", err)
		}
		for _, item := range page.Segment.BlobItems {
			_, err := b.containerClient().NewBlobClient(*item.Name).Delete(ctx, nil)
			if err != nil {
				return fmt.Errorf("storage/azure: delete bucket blob: %w", err)
			}
		}
	}
	return nil
}

func (b *Backend) RenameBucket(ctx context.Context, projectID, oldName, newName string) error {
	oldPrefix := b.prefix(projectID, oldName)
	newPrefix := b.prefix(projectID, newName)

	pager := b.containerClient().NewListBlobsFlatPager(&container.ListBlobsFlatOptions{
		Prefix: &oldPrefix,
	})
	for pager.More() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return fmt.Errorf("storage/azure: rename list: %w", err)
		}
		for _, item := range page.Segment.BlobItems {
			newKey := newPrefix + strings.TrimPrefix(*item.Name, oldPrefix)
			srcURL := b.containerClient().NewBlobClient(*item.Name).URL()
			_, err := b.containerClient().NewBlobClient(newKey).CopyFromURL(ctx, srcURL, nil)
			if err != nil {
				return fmt.Errorf("storage/azure: rename copy: %w", err)
			}
			if _, err := b.containerClient().NewBlobClient(*item.Name).Delete(ctx, nil); err != nil {
				return fmt.Errorf("storage/azure: rename delete old: %w", err)
			}
		}
	}
	return nil
}

func (b *Backend) ListObjects(ctx context.Context, projectID, bucketName, objPrefix string) ([]storage.ObjectInfo, error) {
	prefix := b.prefix(projectID, bucketName) + objPrefix
	basePrefix := b.prefix(projectID, bucketName)

	pager := b.containerClient().NewListBlobsFlatPager(&container.ListBlobsFlatOptions{
		Prefix: &prefix,
	})

	var objects []storage.ObjectInfo
	for pager.More() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("storage/azure: list objects: %w", err)
		}
		for _, item := range page.Segment.BlobItems {
			oi := storage.ObjectInfo{
				Key: strings.TrimPrefix(*item.Name, basePrefix),
			}
			if item.Properties != nil {
				if item.Properties.ContentLength != nil {
					oi.Size = *item.Properties.ContentLength
				}
				if item.Properties.LastModified != nil {
					oi.LastModified = *item.Properties.LastModified
				}
				if item.Properties.ContentType != nil {
					oi.ContentType = *item.Properties.ContentType
				}
			}
			objects = append(objects, oi)
		}
	}
	return objects, nil
}

func (b *Backend) PutObject(ctx context.Context, projectID, bucketName, key string, data io.Reader, _ int64, contentType string) error {
	blobClient := b.containerClient().NewBlockBlobClient(b.blobName(projectID, bucketName, key))
	opts := &azblob.UploadStreamOptions{}
	if contentType != "" {
		opts.HTTPHeaders = &blob.HTTPHeaders{BlobContentType: &contentType}
	}
	_, err := blobClient.UploadStream(ctx, data, opts)
	if err != nil {
		return fmt.Errorf("storage/azure: put object: %w", err)
	}
	return nil
}

func (b *Backend) GetObject(ctx context.Context, projectID, bucketName, key string) (io.ReadCloser, storage.ObjectInfo, error) {
	blobClient := b.containerClient().NewBlobClient(b.blobName(projectID, bucketName, key))
	resp, err := blobClient.DownloadStream(ctx, nil)
	if err != nil {
		return nil, storage.ObjectInfo{}, fmt.Errorf("storage/azure: get object: %w", err)
	}
	info := storage.ObjectInfo{Key: key}
	if resp.ContentLength != nil {
		info.Size = *resp.ContentLength
	}
	if resp.LastModified != nil {
		info.LastModified = *resp.LastModified
	}
	if resp.ContentType != nil {
		info.ContentType = *resp.ContentType
	}
	return resp.Body, info, nil
}

func (b *Backend) DeleteObject(ctx context.Context, projectID, bucketName, key string) error {
	blobClient := b.containerClient().NewBlobClient(b.blobName(projectID, bucketName, key))
	_, err := blobClient.Delete(ctx, nil)
	if err != nil {
		return fmt.Errorf("storage/azure: delete object: %w", err)
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
	blobClient := b.containerClient().NewBlobClient(b.blobName(projectID, bucketName, key))
	props, err := blobClient.GetProperties(ctx, nil)
	if err != nil {
		return storage.ObjectInfo{}, fmt.Errorf("storage/azure: stat object: %w", err)
	}
	info := storage.ObjectInfo{Key: key}
	if props.ContentLength != nil {
		info.Size = *props.ContentLength
	}
	if props.LastModified != nil {
		info.LastModified = *props.LastModified
	}
	if props.ContentType != nil {
		info.ContentType = *props.ContentType
	}
	return info, nil
}
