package repos

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/EliteaAI/elitea-platform/libs/proto/gen/go/elitea/runtime/v1"
	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/transport/redisdispatch"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestPostgresServiceBackedIndexIngestDispatch is a real PostgreSQL 16-18
// service-integration gate. Redis failures are injected at the StreamAppender
// boundary; the existing real-Redis test separately proves atomic capacity and
// delivery-index behavior.
func TestPostgresServiceBackedIndexIngestDispatch(t *testing.T) {
	pool := newPostgresIntegrationPool(t)
	applyPostgresIntegrationMigrations(t, pool)
	policy := IndexIngestDispatchPolicy{
		StreamName:        "elitea:runtime:index:commands",
		CapabilityVersion: "1",
		ResourceClass:     "indexing",
		IsolationClass:    "project",
		Priority:          1,
		DeadlineTTL:       time.Hour,
		LimitsRevision:    "index-limits-v1",
		MaxOutstanding:    16,
	}
	jobs, err := NewIndexIngestJobsRepository(pool, policy)
	if err != nil {
		t.Fatal(err)
	}
	outbox, err := NewCommandOutboxRepository(pool, policy.StreamName)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	redisOutage := errors.New("test Redis unavailable")

	for _, test := range []struct {
		name       string
		prefix     string
		appendErr  error
		errorMatch func(error) bool
	}{
		{
			name:      "Redis outage retains exact durable bytes",
			prefix:    "outage",
			appendErr: redisOutage,
			errorMatch: func(err error) bool {
				return errors.Is(err, redisOutage)
			},
		},
		{
			name:   "capacity retains exact durable bytes",
			prefix: "capacity",
			appendErr: &redisdispatch.ControlStreamSaturatedError{
				CurrentEntries:  8,
				CurrentMappings: 8,
				MaxEntries:      8,
			},
			errorMatch: func(err error) bool {
				return errors.Is(err, executionapp.ErrDispatchBackpressured)
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			outcome, outboxID := admitPostgresIndexDispatch(t, ctx, jobs, test.prefix)
			signer := &postgresIndexDispatchSigner{keyID: "key-" + test.prefix}
			appender := &postgresIndexDispatchAppender{err: test.appendErr}
			producer := newPostgresIndexProducer(t, policy, signer, appender)
			dispatcher, err := indexingapp.NewIndexIngestDispatcher(outbox, producer)
			if err != nil {
				t.Fatal(err)
			}

			if err := dispatcher.Dispatch(ctx, outboxID); !test.errorMatch(err) {
				t.Fatalf("injected append failure = %v", err)
			}
			prepared := assertPostgresIndexDispatchState(t, ctx, pool, outcome.ExecutionID, false, "PENDING", 0)
			if signer.callCount() != 1 || appender.callCount() != 1 || !bytes.Equal(prepared, appender.callBytes(0)) {
				t.Fatal("failed append did not retain its exact prepared envelope")
			}

			appender.setError(nil)
			if err := dispatcher.Dispatch(ctx, outboxID); err != nil {
				t.Fatalf("retry retained index dispatch: %v", err)
			}
			assertPostgresIndexDispatchState(t, ctx, pool, outcome.ExecutionID, true, "DISPATCHED", 1)
			if signer.callCount() != 1 || appender.callCount() != 2 || !bytes.Equal(appender.callBytes(0), appender.callBytes(1)) {
				t.Fatal("retry re-signed or changed the durable index envelope")
			}
		})
	}

	t.Run("competing publishers select one envelope and mark idempotently", func(t *testing.T) {
		outcome, _ := admitPostgresIndexDispatch(t, ctx, jobs, "competing")
		started := make(chan struct{}, 2)
		release := make(chan struct{})
		appender := &postgresIndexDispatchAppender{}
		signers := []*postgresIndexDispatchSigner{
			{keyID: "competing-a", started: started, release: release},
			{keyID: "competing-b", started: started, release: release},
		}
		publishers := make([]*executionapp.OutboxPublisher, 0, 2)
		for _, signer := range signers {
			producer := newPostgresIndexProducer(t, policy, signer, appender)
			dispatcher, err := indexingapp.NewIndexIngestDispatcher(outbox, producer)
			if err != nil {
				t.Fatal(err)
			}
			publisher, err := indexingapp.NewIndexIngestOutboxPublisher(outbox, dispatcher, executionapp.OutboxPublisherConfig{
				PollInterval:      time.Second,
				VisibilityTimeout: time.Minute,
				BatchSize:         1,
				MaxConcurrent:     1,
				ReportFailure:     func(error) {},
			})
			if err != nil {
				t.Fatal(err)
			}
			publishers = append(publishers, publisher)
		}

		results := make(chan error, 2)
		for _, publisher := range publishers {
			go func(publisher *executionapp.OutboxPublisher) {
				results <- publisher.RunOnce(ctx)
			}(publisher)
		}
		for range 2 {
			select {
			case <-started:
			case <-ctx.Done():
				t.Fatalf("competing publishers did not reach signing barrier: %v", ctx.Err())
			}
		}
		close(release)
		for range 2 {
			if err := <-results; err != nil {
				t.Fatalf("competing publisher: %v", err)
			}
		}

		prepared := assertPostgresIndexDispatchState(t, ctx, pool, outcome.ExecutionID, true, "DISPATCHED", 2)
		if appender.callCount() != 2 || !bytes.Equal(appender.callBytes(0), prepared) || !bytes.Equal(appender.callBytes(1), prepared) || signers[0].callCount() != 1 || signers[1].callCount() != 1 {
			t.Fatal("competing publishers did not append the one durable CAS winner")
		}
	})

	t.Run("capability and stream views cannot cross", func(t *testing.T) {
		_, outboxID := admitPostgresIndexDispatch(t, ctx, jobs, "isolation")
		pending, err := outbox.ListPendingIndexIngestIDs(ctx, 16, time.Minute)
		if err != nil {
			t.Fatal(err)
		}
		if !containsAdmissionID(pending, outboxID) {
			t.Fatalf("index view omitted its own pending command: %v", pending)
		}
		validationView, err := NewCommandOutboxRepository(pool, policy.StreamName)
		if err != nil {
			t.Fatal(err)
		}
		validationIDs, err := validationView.ListPendingValidationIDs(ctx, 16, time.Minute)
		if err != nil {
			t.Fatal(err)
		}
		if containsAdmissionID(validationIDs, outboxID) {
			t.Fatalf("index command leaked into validation capability view: %v", validationIDs)
		}
		wrongStream, err := NewCommandOutboxRepository(pool, "elitea:runtime:validation:commands")
		if err != nil {
			t.Fatal(err)
		}
		wrongStreamIDs, err := wrongStream.ListPendingIndexIngestIDs(ctx, 16, time.Minute)
		if err != nil {
			t.Fatal(err)
		}
		if containsAdmissionID(wrongStreamIDs, outboxID) {
			t.Fatalf("index command leaked into another stream: %v", wrongStreamIDs)
		}
	})
}

func admitPostgresIndexDispatch(t *testing.T, ctx context.Context, jobs *IndexIngestJobsRepository, prefix string) (executionapp.AdmissionOutcome, string) {
	t.Helper()
	outcome, err := newPostgresIndexAdmissionService(t, jobs, prefix).Submit(ctx, postgresIndexSubmitRequest("request-"+prefix, "idx"))
	if err != nil || !outcome.Created {
		t.Fatalf("admit %s index dispatch: outcome=%+v err=%v", prefix, outcome, err)
	}
	return outcome, prefix + "-outbox"
}

func newPostgresIndexProducer(t *testing.T, policy IndexIngestDispatchPolicy, signer redisdispatch.CommandSigner, appender redisdispatch.StreamAppender) *redisdispatch.IndexIngestProducer {
	t.Helper()
	producer, err := redisdispatch.NewIndexIngestProducer(redisdispatch.IndexIngestProducerConfig{
		Stream:                 policy.StreamName,
		ConsumerGroup:          "elitea-indexer-worker-v1",
		ValidationStream:       "elitea:runtime:validation:commands",
		ProtocolRevision:       "runtime-v1",
		EnvelopeSchemaRevision: "signed-worker-command-v1",
		CapabilityVersion:      policy.CapabilityVersion,
		Limits: redisdispatch.Limits{
			Revision:               policy.LimitsRevision,
			MaxWorkerCommandBytes:  8 * 1024,
			MaxSignedEnvelopeBytes: 12 * 1024,
			MaxRedisFieldBytes:     12 * 1024,
			MaxRedisEntryBytes:     16 * 1024,
			MaxSignatureBytes:      128,
			MaxStringBytes:         512,
		},
		AllowTestOnlyHMAC: true,
	}, signer, appender)
	if err != nil {
		t.Fatal(err)
	}
	return producer
}

func assertPostgresIndexDispatchState(t *testing.T, ctx context.Context, pool *pgxpool.Pool, executionID string, published bool, state string, attempts int32) []byte {
	t.Helper()
	var prepared []byte
	var storedPublished bool
	var storedState string
	var storedAttempts int32
	if err := pool.QueryRow(ctx, `
SELECT o.prepared_signed_envelope_bytes,
       o.published_at IS NOT NULL,
       j.state,
       o.publish_attempts
FROM elitea_runtime.execution_jobs AS j
JOIN elitea_runtime.command_outbox AS o
  ON o.execution_id = j.execution_id AND o.generation = j.generation
WHERE j.execution_id = $1
  AND j.capability_id = 'index.ingest.v1'`, executionID).Scan(
		&prepared,
		&storedPublished,
		&storedState,
		&storedAttempts,
	); err != nil {
		t.Fatal(err)
	}
	if len(prepared) == 0 || storedPublished != published || storedState != state || storedAttempts != attempts {
		t.Fatalf("unexpected durable index dispatch state: bytes=%d published=%v state=%s attempts=%d", len(prepared), storedPublished, storedState, storedAttempts)
	}
	return bytes.Clone(prepared)
}

type postgresIndexDispatchSigner struct {
	keyID   string
	started chan<- struct{}
	release <-chan struct{}

	mu    sync.Mutex
	calls int
}

func (s *postgresIndexDispatchSigner) SignWorkerCommand(ctx context.Context, exact []byte) (redisdispatch.Signature, error) {
	s.mu.Lock()
	s.calls++
	s.mu.Unlock()
	if s.started != nil {
		select {
		case s.started <- struct{}{}:
		case <-ctx.Done():
			return redisdispatch.Signature{}, ctx.Err()
		}
	}
	if s.release != nil {
		select {
		case <-s.release:
		case <-ctx.Done():
			return redisdispatch.Signature{}, ctx.Err()
		}
	}
	material := append([]byte(s.keyID+":"), exact...)
	signature := sha256.Sum256(material)
	return redisdispatch.Signature{
		Profile: runtimev1.SignatureProfileV1_SIGNATURE_PROFILE_V1_TEST_ONLY_HMAC_SHA256,
		KeyID:   s.keyID,
		Value:   signature[:],
	}, nil
}

func (s *postgresIndexDispatchSigner) callCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.calls
}

type postgresIndexDispatchAppender struct {
	mu    sync.Mutex
	err   error
	calls [][]byte
}

func (a *postgresIndexDispatchAppender) Append(_ context.Context, _, _, deliveryID string, value []byte) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.calls = append(a.calls, bytes.Clone(value))
	if a.err != nil {
		return "", a.err
	}
	return fmt.Sprintf("%s-%d", deliveryID, len(a.calls)), nil
}

func (a *postgresIndexDispatchAppender) setError(err error) {
	a.mu.Lock()
	a.err = err
	a.mu.Unlock()
}

func (a *postgresIndexDispatchAppender) callCount() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return len(a.calls)
}

func (a *postgresIndexDispatchAppender) callBytes(index int) []byte {
	a.mu.Lock()
	defer a.mu.Unlock()
	return bytes.Clone(a.calls[index])
}
