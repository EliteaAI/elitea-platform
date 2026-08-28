package hopmarker

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

// TestNew_ReplicaIdentical is the constraint a routing loop makes load-bearing:
// the loop can leave through replica A and re-enter on replica B, so B has to
// recognise A's marker. Two independently constructed markers over the same key
// material must therefore be interchangeable.
//
// A per-process or clock-seeded value would pass every other test in this file
// and fail only in production, on the replica count that CI never runs.
func TestNew_ReplicaIdentical(t *testing.T) {
	replicaA := New([]byte("hop-secret"))
	replicaB := New([]byte("hop-secret"))

	if replicaA.Value() != replicaB.Value() {
		t.Fatalf("two replicas produced different markers:\n  A: %q\n  B: %q\n"+
			"A loop that leaves through A and re-enters on B is then invisible to B.",
			replicaA.Value(), replicaB.Value())
	}
	if !replicaB.Matches(replicaA.Value()) {
		t.Errorf("replica B does not recognise replica A's marker %q", replicaA.Value())
	}
	if !replicaA.Matches(replicaB.Value()) {
		t.Errorf("replica A does not recognise replica B's marker %q", replicaB.Value())
	}
}

// TestNew_DifferentSecretsDoNotCollide pins the other half of the same
// property: a marker is a property of the KEY, so a different key must produce
// a marker this deployment does not recognise. Without this, a second Elitea
// deployment used as a legitimate upstream would have its ordinary traffic
// refused as a loop.
func TestNew_DifferentSecretsDoNotCollide(t *testing.T) {
	ours := New([]byte("our-hop-secret"))
	theirs := New([]byte("their-hop-secret"))

	if ours.Value() == theirs.Value() {
		t.Fatal("two different secrets produced the same marker")
	}
	if ours.Matches(theirs.Value()) {
		t.Error("this deployment recognised another deployment's marker as its own")
	}
}

// TestNew_ValueIsTheDomainSeparatedMAC pins the value construction itself. The
// marker is HMAC over a FIXED message, so the wire value is fully determined by
// the key; recomputing it here is what makes a silent change to the scheme —
// a different message, a different hash, a truncated digest — fail.
func TestNew_ValueIsTheDomainSeparatedMAC(t *testing.T) {
	secret := []byte("hop-secret")

	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte("elitea-llm-gateway/hop-marker/v1"))
	want := "v1=" + hex.EncodeToString(mac.Sum(nil))

	if got := New(secret).Value(); got != want {
		t.Fatalf("marker value = %q, want %q", got, want)
	}
}

// TestNew_NotDerivedFromTheIdentitySecret is the issue's explicit constraint
// (#164): the marker travels to every upstream, and a provider api_base is
// tenant-authored, so the marker must not be a function of the key that signs
// the X-Elitea-* identity headers.
//
// The check this file can make is that the marker is a function of ITS OWN
// argument and of nothing else — feed it the identity secret and you get a
// different value, so nothing in this package reaches for that key. The other
// half of the constraint (that main() passes GATEWAY_HOP_SECRET and not
// cfg.IdentitySecret) is pinned in cmd/elitea-llm-gateway.
func TestNew_NotDerivedFromTheIdentitySecret(t *testing.T) {
	identitySecret := []byte("identity-secret")
	hopSecret := []byte("hop-secret")

	if New(hopSecret).Value() == New(identitySecret).Value() {
		t.Fatal("the marker is the same under two different keys, so it is not keyed by its argument")
	}
	// The marker must not merely CONTAIN the key either.
	if strings.Contains(New(hopSecret).Value(), string(hopSecret)) {
		t.Error("the marker value carries its own key material in the clear")
	}
}

// TestUnarmed_IsSafeAndInert covers the nil marker: an empty secret is a
// supported posture, and every method must work on it. A panic here would turn
// "operator did not set GATEWAY_HOP_SECRET" into a crash loop.
func TestUnarmed_IsSafeAndInert(t *testing.T) {
	unarmed := New(nil)
	if unarmed != nil {
		t.Fatalf("New(nil) = %v, want the nil (unarmed) marker", unarmed)
	}
	if unarmed.Armed() {
		t.Error("the unarmed marker reports itself armed")
	}
	if got := unarmed.Value(); got != "" {
		t.Errorf("unarmed Value() = %q, want \"\" so no header is stamped", got)
	}
	// It must recognise NOTHING — including the value an armed deployment
	// would produce. An unarmed gateway that refused traffic would be worse
	// than one that detects nothing.
	if unarmed.Matches(New([]byte("hop-secret")).Value()) {
		t.Error("the unarmed marker matched an armed deployment's value")
	}
	if unarmed.Matches("") {
		t.Error("the unarmed marker matched the empty header")
	}
}

// TestMatches_RejectsNonMarkers walks the values an inbound request can carry
// that are NOT this deployment's marker. Every one of them must pass through:
// refusing a request over a header the gateway did not write would make any
// client able to deny any other client by guessing.
func TestMatches_RejectsNonMarkers(t *testing.T) {
	m := New([]byte("hop-secret"))
	ours := m.Value()

	for _, tc := range []struct {
		name string
		got  string
	}{
		{"absent", ""},
		{"empty version only", "v1="},
		{"garbage", "not-a-marker"},
		{"another deployment", New([]byte("other")).Value()},
		{"truncated", ours[:len(ours)-1]},
		{"one hex digit flipped", flipLastHexDigit(ours)},
		{"right digest, wrong version prefix", "v2=" + strings.SplitN(ours, "=", 2)[1]},
		{"our value with trailing space", ours + " "},
	} {
		if m.Matches(tc.got) {
			t.Errorf("%s: Matches(%q) = true, want false", tc.name, tc.got)
		}
	}

	if !m.Matches(ours) {
		t.Errorf("Matches(%q) = false for our own marker", ours)
	}
}

func flipLastHexDigit(v string) string {
	if v == "" {
		return v
	}
	last := v[len(v)-1]
	replacement := byte('0')
	if last == '0' {
		replacement = '1'
	}
	return v[:len(v)-1] + string(replacement)
}
