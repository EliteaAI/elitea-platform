package azure

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore"
	"github.com/Azure/azure-sdk-for-go/sdk/azidentity"
	"github.com/Azure/azure-sdk-for-go/sdk/storage/azblob"
	"github.com/Azure/azure-sdk-for-go/sdk/storage/azblob/blob"
	"github.com/Azure/azure-sdk-for-go/sdk/storage/azblob/bloberror"
	"github.com/Azure/azure-sdk-for-go/sdk/storage/azblob/container"
	"github.com/Azure/azure-sdk-for-go/sdk/storage/azblob/sas"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
)

// Config holds Azure Blob-specific configuration.
type Config struct {
	Account       string
	Key           string
	ContainerName string // single container used as root

	// Endpoint overrides the default public-cloud service URL
	// (https://{Account}.blob.core.windows.net/) verbatim. Set it to reach
	// Azurite or a non-public-cloud deployment.
	Endpoint string

	// KeyPrefix namespaces every ObjectStore key under ContainerName; passed
	// through to ObjectRef.StorageKey/BucketPrefix. Optional, empty by
	// default.
	KeyPrefix string
}

// Backend implements storage.Backend using Azure Blob Storage.
// All objects live in a single container with blob name: {projectID}/{bucketName}/{key}
type Backend struct {
	client        *azblob.Client
	containerName string
	keyPrefix     string

	// usesSharedKey records which credential path New took. blob.Client's
	// GetSASURL requires a shared key; a token-credential (workload
	// identity) client must mint a user-delegation SAS instead, which
	// Azurite does not support. Capabilities() (S3) reads this.
	usesSharedKey bool
}

var _ storage.Backend = (*Backend)(nil)
var _ storage.ObjectStore = (*Backend)(nil)

// New creates an Azure Blob Backend. When cfg.Key is set it authenticates
// with a shared-key credential; otherwise it uses DefaultAzureCredential,
// enabling workload identity.
func New(_ context.Context, cfg Config) (*Backend, error) {
	serviceURL := cfg.Endpoint
	if serviceURL == "" {
		serviceURL = fmt.Sprintf("https://%s.blob.core.windows.net/", cfg.Account)
	}

	usesSharedKey := cfg.Key != ""
	var client *azblob.Client
	if usesSharedKey {
		cred, err := azblob.NewSharedKeyCredential(cfg.Account, cfg.Key)
		if err != nil {
			return nil, fmt.Errorf("storage/azure: credential: %w", err)
		}
		client, err = azblob.NewClientWithSharedKeyCredential(serviceURL, cred, nil)
		if err != nil {
			return nil, fmt.Errorf("storage/azure: client: %w", err)
		}
	} else {
		cred, err := azidentity.NewDefaultAzureCredential(nil)
		if err != nil {
			return nil, fmt.Errorf("storage/azure: default credential: %w", err)
		}
		client, err = azblob.NewClient(serviceURL, cred, nil)
		if err != nil {
			return nil, fmt.Errorf("storage/azure: client: %w", err)
		}
	}
	return &Backend{
		client:        client,
		containerName: cfg.ContainerName,
		keyPrefix:     cfg.KeyPrefix,
		usesSharedKey: usesSharedKey,
	}, nil
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

// --- storage.ObjectStore ---
//
// The methods below operate against a single container (b.containerName),
// namespaced by ObjectRef.StorageKey(b.keyPrefix). They coexist with the old
// Backend methods above, which keep their own {projectID}/{bucketName}/{key}
// blob-name convention untouched.

// Capabilities reports NativeMultipart alongside Presign, not unconditionally
// true. PresignPart needs a SAS URL exactly like PresignGet/PresignPut, and
// GetSASURL only works with a shared-key credential — a user-delegation SAS
// could in principle cover the token-credential case too, but Azurite (this
// plan's own local/CI emulator, S4) does not issue user-delegation keys, so
// that path could not be exercised by the conformance suite even if built.
func (b *Backend) Capabilities() storage.Capabilities {
	return storage.Capabilities{Presign: b.usesSharedKey, NativeMultipart: b.usesSharedKey, ServerSideCopy: true}
}

func (b *Backend) Put(ctx context.Context, ref storage.ObjectRef, body io.Reader, opts storage.PutOptions) (storage.ObjectInfo, error) {
	blobClient := b.containerClient().NewBlockBlobClient(ref.StorageKey(b.keyPrefix))
	uploadOpts := &azblob.UploadStreamOptions{
		// The library defaults (1 MiB block, concurrency 1) cap an object at
		// 50000 blocks x 1 MiB =~ 48.8 GiB and serialise every upload. 8 MiB
		// raises the ceiling to about 390 GiB.
		BlockSize:   8 << 20,
		Concurrency: 4,
	}
	if opts.ContentType != "" {
		contentType := opts.ContentType
		uploadOpts.HTTPHeaders = &blob.HTTPHeaders{BlobContentType: &contentType}
	}
	if len(opts.Metadata) > 0 {
		meta := make(map[string]*string, len(opts.Metadata))
		for k, v := range opts.Metadata {
			v := v
			meta[k] = &v
		}
		uploadOpts.Metadata = meta
	}
	resp, err := blobClient.UploadStream(ctx, body, uploadOpts)
	if err != nil {
		return storage.ObjectInfo{}, mapAzureError(err, "put object")
	}
	return storage.ObjectInfo{
		Key:          ref.Key(),
		ContentType:  opts.ContentType,
		ETag:         derefETagString(resp.ETag),
		LastModified: derefTime(resp.LastModified),
	}, nil
}

func (b *Backend) Get(ctx context.Context, ref storage.ObjectRef, rng *storage.ByteRange) (io.ReadCloser, storage.ObjectInfo, error) {
	blobClient := b.containerClient().NewBlobClient(ref.StorageKey(b.keyPrefix))
	opts := &blob.DownloadStreamOptions{}
	if rng != nil {
		count := int64(0)
		if rng.End >= 0 {
			count = rng.End - rng.Start + 1
		}
		opts.Range = blob.HTTPRange{Offset: rng.Start, Count: count}
	}
	resp, err := blobClient.DownloadStream(ctx, opts)
	if err != nil {
		return nil, storage.ObjectInfo{}, mapAzureError(err, "get object")
	}
	info := storage.ObjectInfo{
		Key:          ref.Key(),
		Size:         derefInt64(resp.ContentLength),
		LastModified: derefTime(resp.LastModified),
		ContentType:  derefString(resp.ContentType),
		ETag:         derefETagString(resp.ETag),
	}
	return resp.Body, info, nil
}

func (b *Backend) Stat(ctx context.Context, ref storage.ObjectRef) (storage.ObjectInfo, error) {
	blobClient := b.containerClient().NewBlobClient(ref.StorageKey(b.keyPrefix))
	props, err := blobClient.GetProperties(ctx, nil)
	if err != nil {
		return storage.ObjectInfo{}, mapAzureError(err, "stat object")
	}
	return storage.ObjectInfo{
		Key:          ref.Key(),
		Size:         derefInt64(props.ContentLength),
		LastModified: derefTime(props.LastModified),
		ContentType:  derefString(props.ContentType),
		ETag:         derefETagString(props.ETag),
	}, nil
}

// Delete swallows BlobNotFound and ContainerNotFound and returns nil,
// matching the interface's idempotency rule.
func (b *Backend) Delete(ctx context.Context, ref storage.ObjectRef) error {
	_, err := b.containerClient().NewBlobClient(ref.StorageKey(b.keyPrefix)).Delete(ctx, nil)
	if err != nil {
		if bloberror.HasCode(err, bloberror.BlobNotFound, bloberror.ContainerNotFound) {
			return nil
		}
		return mapAzureError(err, "delete object")
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
	prefix := basePrefix + q.KeyPrefix

	var maxResults *int32
	if q.MaxKeys > 0 {
		mk := q.MaxKeys
		if mk > 1000 {
			mk = 1000
		}
		maxResults = &mk
	}
	var marker *string
	if q.ContinuationToken != "" {
		marker = &q.ContinuationToken
	}

	page := storage.ListPage{}
	if q.Delimiter != "" {
		pager := b.containerClient().NewListBlobsHierarchyPager(q.Delimiter, &container.ListBlobsHierarchyOptions{
			Prefix:     &prefix,
			Marker:     marker,
			MaxResults: maxResults,
		})
		resp, err := pager.NextPage(ctx)
		if err != nil {
			return storage.ListPage{}, mapAzureError(err, "list objects")
		}
		for _, item := range resp.Segment.BlobItems {
			page.Objects = append(page.Objects, blobItemToObjectInfo(item, basePrefix))
		}
		for _, bp := range resp.Segment.BlobPrefixes {
			page.CommonPrefixes = append(page.CommonPrefixes, strings.TrimPrefix(derefString(bp.Name), basePrefix))
		}
		page.NextContinuationToken = derefString(resp.NextMarker)
		page.IsTruncated = page.NextContinuationToken != ""
		return page, nil
	}

	pager := b.containerClient().NewListBlobsFlatPager(&container.ListBlobsFlatOptions{
		Prefix:     &prefix,
		Marker:     marker,
		MaxResults: maxResults,
	})
	resp, err := pager.NextPage(ctx)
	if err != nil {
		return storage.ListPage{}, mapAzureError(err, "list objects")
	}
	for _, item := range resp.Segment.BlobItems {
		page.Objects = append(page.Objects, blobItemToObjectInfo(item, basePrefix))
	}
	page.NextContinuationToken = derefString(resp.NextMarker)
	page.IsTruncated = page.NextContinuationToken != ""
	return page, nil
}

func blobItemToObjectInfo(item *container.BlobItem, basePrefix string) storage.ObjectInfo {
	info := storage.ObjectInfo{Key: strings.TrimPrefix(derefString(item.Name), basePrefix)}
	if item.Properties != nil {
		info.Size = derefInt64(item.Properties.ContentLength)
		info.LastModified = derefTime(item.Properties.LastModified)
		info.ContentType = derefString(item.Properties.ContentType)
		info.ETag = derefETagString(item.Properties.ETag)
	}
	return info
}

func (b *Backend) PresignGet(ctx context.Context, ref storage.ObjectRef, ttl time.Duration) (string, error) {
	if !b.usesSharedKey {
		return "", storage.ErrNotSupported
	}
	blobClient := b.containerClient().NewBlobClient(ref.StorageKey(b.keyPrefix))
	presignedURL, err := blobClient.GetSASURL(sas.BlobPermissions{Read: true}, time.Now().Add(ttl), nil)
	if err != nil {
		return "", fmt.Errorf("storage/azure: presign get: %w", err)
	}
	return presignedURL, nil
}

// PresignPut's opts.ContentType, when set, is not covered by the SAS
// signature — like S3, a presigned PUT does not enforce media type at the
// storage layer. S15 verifies it on commit.
func (b *Backend) PresignPut(ctx context.Context, ref storage.ObjectRef, ttl time.Duration, opts storage.PutOptions) (string, error) {
	if !b.usesSharedKey {
		return "", storage.ErrNotSupported
	}
	blobClient := b.containerClient().NewBlockBlobClient(ref.StorageKey(b.keyPrefix))
	presignedURL, err := blobClient.GetSASURL(sas.BlobPermissions{Write: true, Create: true}, time.Now().Add(ttl), nil)
	if err != nil {
		return "", fmt.Errorf("storage/azure: presign put: %w", err)
	}
	return presignedURL, nil
}

// StartMultipart has no server round trip on Azure: blocks are staged
// directly against the target blob path with client-chosen block IDs and
// assembled later via CommitBlockList. The returned UploadID is a random
// correlation token used only to derive deterministic block IDs in
// PresignPart/CompleteMultipart below; Azure never sees it.
func (b *Backend) StartMultipart(ctx context.Context, ref storage.ObjectRef, opts storage.PutOptions) (storage.UploadID, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("storage/azure: start multipart: %w", err)
	}
	return storage.UploadID(hex.EncodeToString(buf)), nil
}

// blockID deterministically derives a block ID from id and part. Azure
// requires every block ID committed to one blob to be the same length once
// base64-decoded; id is always a fixed-length 32 hex-character string and
// part is always formatted to 10 digits, so the pre-encoding length is
// constant across every part of a given upload.
func blockID(id storage.UploadID, part int32) string {
	raw := fmt.Sprintf("%s-%010d", id, part)
	return base64.StdEncoding.EncodeToString([]byte(raw))
}

func (b *Backend) PresignPart(ctx context.Context, ref storage.ObjectRef, id storage.UploadID, part int32, ttl time.Duration) (string, error) {
	if !b.usesSharedKey {
		return "", storage.ErrNotSupported
	}
	blobClient := b.containerClient().NewBlockBlobClient(ref.StorageKey(b.keyPrefix))
	sasURL, err := blobClient.GetSASURL(sas.BlobPermissions{Write: true, Create: true}, time.Now().Add(ttl), nil)
	if err != nil {
		return "", fmt.Errorf("storage/azure: presign part: %w", err)
	}
	sep := "&"
	if !strings.Contains(sasURL, "?") {
		sep = "?"
	}
	return sasURL + sep + "comp=block&blockid=" + url.QueryEscape(blockID(id, part)), nil
}

func (b *Backend) CompleteMultipart(ctx context.Context, ref storage.ObjectRef, id storage.UploadID, parts []storage.Part) (storage.ObjectInfo, error) {
	sorted := append([]storage.Part(nil), parts...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Number < sorted[j].Number })

	blockIDs := make([]string, len(sorted))
	for i, p := range sorted {
		blockIDs[i] = blockID(id, p.Number)
	}

	blobClient := b.containerClient().NewBlockBlobClient(ref.StorageKey(b.keyPrefix))
	resp, err := blobClient.CommitBlockList(ctx, blockIDs, nil)
	if err != nil {
		return storage.ObjectInfo{}, mapAzureError(err, "complete multipart")
	}
	return storage.ObjectInfo{
		Key:          ref.Key(),
		ETag:         derefETagString(resp.ETag),
		LastModified: derefTime(resp.LastModified),
	}, nil
}

// AbortMultipart is a no-op: Azure has no explicit abort API for staged
// blocks. Uncommitted blocks are automatically garbage-collected roughly a
// week after their last staging call regardless of any explicit action —
// this is also what S14's coarse provider-native lifecycle rule configures.
func (b *Backend) AbortMultipart(ctx context.Context, ref storage.ObjectRef, id storage.UploadID) error {
	return nil
}

func derefTime(t *time.Time) time.Time {
	if t == nil {
		return time.Time{}
	}
	return *t
}

func derefString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func derefInt64(i *int64) int64 {
	if i == nil {
		return 0
	}
	return *i
}

func derefETagString(e *azcore.ETag) string {
	if e == nil {
		return ""
	}
	return string(*e)
}

// mapAzureError maps not-found and access-denied blob error codes to the
// shared sentinels, wrapping the original error so errors.Is still finds it.
func mapAzureError(err error, op string) error {
	if bloberror.HasCode(err, bloberror.BlobNotFound, bloberror.ContainerNotFound) {
		return fmt.Errorf("storage/azure: %s: %w", op, storage.ErrNotFound)
	}
	if bloberror.HasCode(err, bloberror.AuthenticationFailed, bloberror.AuthorizationFailure, bloberror.AuthorizationPermissionMismatch) {
		return fmt.Errorf("storage/azure: %s: %w", op, storage.ErrAccessDenied)
	}
	return fmt.Errorf("storage/azure: %s: %w", op, err)
}
