package s3

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// TestArtifactRetentionS3LifecycleRuleIsActiveAfterStartup is S14 item 5's
// acceptance criterion for this backend: "The configured backend reports an
// active multipart-abort lifecycle rule after startup" — not just that
// ConfigureRetentionLifecycle doesn't error, but that a subsequent
// GetBucketLifecycleConfiguration call actually reports the rule it set.
// Run live against RustFS (this stack's S3 emulator); confirmed
// empirically outside this test suite that RustFS both accepts and
// round-trips PutBucketLifecycleConfiguration, unlike fake-gcs-server's
// silent no-persist behavior for the GCS equivalent (see
// gcs/backend.go's ConfigureRetentionLifecycle comment).
func TestArtifactRetentionS3LifecycleRuleIsActiveAfterStartup(t *testing.T) {
	ctx := context.Background()
	endpoint := os.Getenv("S3_ENDPOINT_URL")
	if endpoint == "" {
		t.Skip("S3_ENDPOINT_URL not set; skipping (see deploy/docker-compose.storage-test.yml)")
	}
	accessKey := os.Getenv("S3_ACCESS_KEY")
	secretKey := os.Getenv("S3_SECRET_KEY")
	region := os.Getenv("S3_REGION")
	if region == "" {
		region = "us-east-1"
	}
	forcePathStyle := os.Getenv("S3_FORCE_PATH_STYLE") == "true"
	const bucket = "elitea-lifecycle-rule-test"

	awsCfg, err := awsconfig.LoadDefaultConfig(ctx,
		awsconfig.WithRegion(region),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(accessKey, secretKey, "")),
	)
	if err != nil {
		t.Fatalf("load aws config: %v", err)
	}
	raw := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(endpoint)
		o.UsePathStyle = forcePathStyle
	})
	if _, err := raw.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: aws.String(bucket)}); err != nil {
		var alreadyOwned *types.BucketAlreadyOwnedByYou
		var alreadyExists *types.BucketAlreadyExists
		if !errors.As(err, &alreadyOwned) && !errors.As(err, &alreadyExists) {
			t.Fatalf("create bucket: %v", err)
		}
	}

	backend, err := New(ctx, Config{
		Endpoint:       endpoint,
		AccessKey:      accessKey,
		SecretKey:      secretKey,
		Region:         region,
		ForcePathStyle: forcePathStyle,
		Bucket:         bucket,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if err := backend.ConfigureRetentionLifecycle(ctx); err != nil {
		t.Fatalf("ConfigureRetentionLifecycle: %v", err)
	}

	out, err := raw.GetBucketLifecycleConfiguration(ctx, &s3.GetBucketLifecycleConfigurationInput{Bucket: aws.String(bucket)})
	if err != nil {
		t.Fatalf("GetBucketLifecycleConfiguration: %v", err)
	}
	if len(out.Rules) == 0 {
		t.Fatal("expected at least one lifecycle rule after New(), got none")
	}
	var found bool
	for _, rule := range out.Rules {
		if rule.AbortIncompleteMultipartUpload != nil &&
			rule.AbortIncompleteMultipartUpload.DaysAfterInitiation != nil &&
			*rule.AbortIncompleteMultipartUpload.DaysAfterInitiation == 7 &&
			rule.Status == types.ExpirationStatusEnabled {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("no enabled AbortIncompleteMultipartUpload(7 days) rule found among: %+v", out.Rules)
	}
}
