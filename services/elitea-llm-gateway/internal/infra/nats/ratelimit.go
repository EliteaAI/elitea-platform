package nats

// ratelimit.go — the governance rate-limit counter stream.
//
// Rate limits are authored in gateway.governance_config and enforced on the
// /llm admission path (internal/policy). They need a counter that every replica
// shares, for the same reason budgets do: a per-replica limiter multiplies the
// operator's number by the replica count, so "60 requests per minute" quietly
// becomes 180 on a three-pod deployment. That is not a limit an operator can
// reason about, and it is the failure mode this stream exists to avoid.
//
// It is a SEPARATE stream from GATEWAY_BUDGET rather than more subjects under
// it, because the two have opposite retention needs. A budget counter must
// survive the whole billing period; a rate-limit counter is dead the moment its
// minute ends, and a stream holding one subject per minute per scope forever
// would grow without bound. MaxAge expires them instead.

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
)

const (
	// RateLimitStream is the counter stream holding per-window rate-limit
	// counts, one running total per subject.
	RateLimitStream = "GATEWAY_RATELIMIT"
	// rateLimitSubjectRoot is the wildcard the rate-limit stream binds.
	rateLimitSubjectRoot = "gateway.ratelimit.counter"

	// RateLimitWindow is the fixed window rate limits are counted over. The
	// authored fields are "per minute", so the window is a minute; changing it
	// would change what the operator's number means.
	RateLimitWindow = time.Minute

	// rateLimitMaxAge expires a window's counter well after the window closes.
	// It is several windows long rather than exactly one so a request that
	// arrives at the very end of a window still reads a counter that exists,
	// and short enough that the stream's subject space stays bounded.
	rateLimitMaxAge = 5 * time.Minute

	// RateKindRequests and RateKindTokens are the two counter families. They
	// are separate subjects so a token count can never be read as a request
	// count — the two have wildly different magnitudes and confusing them would
	// refuse every request the moment one completion returned.
	RateKindRequests = "req"
	RateKindTokens   = "tok"
)

// RateLimitSubject builds the counter subject for one rate-limit bucket.
//
// key identifies the bucket (the rule and the project it applies to);
// windowUnix is the Unix second the window started, which is what makes the
// counter reset without anyone having to clear it. The caller sanitises key to
// the NATS token charset — see policy.RateLimitKey, which is the only producer.
func RateLimitSubject(kind, key string, windowUnix int64) string {
	return fmt.Sprintf("%s.%s.%s.%d", rateLimitSubjectRoot, kind, key, windowUnix)
}

// WindowStart returns the Unix second at which t's rate-limit window began.
func WindowStart(t time.Time) int64 {
	return t.UTC().Truncate(RateLimitWindow).Unix()
}

// IncrRateLimit atomically adds delta to the bucket for subject and returns the
// new running total. Breaker-guarded and OpTimeout-bounded like every other
// counter operation.
func (c *Client) IncrRateLimit(ctx context.Context, subject string, delta int64) (int64, error) {
	var total int64
	_, err := c.breaker.Execute(func() (uint64, error) {
		octx, cancel := context.WithTimeout(ctx, OpTimeout)
		defer cancel()
		msg := &nats.Msg{
			Subject: subject,
			Header:  nats.Header{IncrHeader: []string{strconv.FormatInt(delta, 10)}},
		}
		ack, err := c.pub.PublishMsg(octx, msg)
		if err != nil {
			return 0, err
		}
		t, perr := strconv.ParseInt(ack.Value, 10, 64)
		if perr != nil {
			return 0, fmt.Errorf("nats: rate-limit counter ack %q: %w", ack.Value, perr)
		}
		total = t
		return 0, nil
	})
	if err != nil {
		return 0, mapErr(err)
	}
	return total, nil
}

// ReadRateLimit returns the current count for subject, or 0 when the bucket has
// never been incremented in this window.
func (c *Client) ReadRateLimit(ctx context.Context, subject string) (int64, error) {
	var total int64
	_, err := c.breaker.Execute(func() (uint64, error) {
		octx, cancel := context.WithTimeout(ctx, OpTimeout)
		defer cancel()
		if c.ratelimit == nil {
			return 0, fmt.Errorf("nats: rate-limit stream not bound")
		}
		raw, err := c.ratelimit.GetLastMsgForSubject(octx, subject)
		if err != nil {
			if errors.Is(err, jetstream.ErrMsgNotFound) {
				total = 0
				return 0, nil
			}
			return 0, err
		}
		t, perr := counterValue(raw)
		if perr != nil {
			return 0, perr
		}
		total = t
		return 0, nil
	})
	if err != nil {
		return 0, mapErr(err)
	}
	return total, nil
}

// ensureRateLimitAssets creates and binds the rate-limit counter stream. It is
// called from ensureAssets and follows the same idempotent CreateOrUpdate
// pattern as the budget stream.
func (c *Client) ensureRateLimitAssets(ctx context.Context, prov assetProvisioner) error {
	if _, err := prov.CreateOrUpdateStream(ctx, jetstream.StreamConfig{
		Name:            RateLimitStream,
		Subjects:        []string{rateLimitSubjectRoot + ".>"},
		Storage:         jetstream.FileStorage,
		Replicas:        c.cfg.Replicas,
		Retention:       jetstream.LimitsPolicy,
		AllowMsgCounter: true,
		// Only the running total matters, exactly as for the budget stream.
		MaxMsgsPerSubject: 1,
		// The bound that keeps one-subject-per-minute-per-scope from growing
		// without limit. There is deliberately no Duplicates window: a
		// rate-limit increment is never replayed, so a dedup window would only
		// cost memory.
		MaxAge: rateLimitMaxAge,
	}); err != nil {
		return fmt.Errorf("nats: ensure rate-limit counter stream: %w", err)
	}
	st, err := prov.Stream(ctx, RateLimitStream)
	if err != nil {
		return fmt.Errorf("nats: bind rate-limit stream: %w", err)
	}
	c.ratelimit = st
	return nil
}
