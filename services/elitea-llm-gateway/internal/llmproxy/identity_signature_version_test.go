package llmproxy

// The v1/v2 signature compatibility pair.
//
// The canonical signing string is DUPLICATED ACROSS TWO INDEPENDENTLY DEPLOYED
// GO MODULES — this one verifies it and elitea-main's internal/llmproxy signs
// it — so it cannot be changed in place: during a rolling deploy an edge
// signing one scheme talks to a gateway verifying the other, and a mismatch
// fails EVERY gateway request in both directions.
//
// These tests pin both halves of the contract:
//
//   - the v1 canonical string and its digest are FROZEN. The digest below is a
//     literal, not a value recomputed from the code under test, so a change to
//     canonical() cannot quietly move it. The identical literal is asserted in
//     elitea-main's own test file, which is the only way two modules that
//     cannot import each other can be held to one wire format.
//   - a v2-signed request verifies, and a v1-signed one still does.
//   - a v1 signature beside an execution-id header is REFUSED, because the v1
//     string does not cover that id and accepting the pair would make it
//     caller-attachable.

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"testing"
)

// frozenSecret and the two digests below are the cross-module wire contract.
// They are literals on purpose: a test that recomputes the expected value from
// the code it is testing cannot detect a change to that code.
const (
	frozenSecret = "shared-identity-secret"

	// sha256_hmac("v1\n42\n7\ntenant-a") under frozenSecret.
	frozenV1Digest = "sha256=6cca2fb17dc0846a9b1054cc48671c39ac26c82974e4519477b05f05addfb81c"
	// sha256_hmac("v2\n42\n7\ntenant-a\nexec-9") under frozenSecret.
	frozenV2Digest = "sha256=ef572fc69c2bd8190b14b04dcfb1b78cf40bdf01f7d044703cba3d7bd5fd7dd9"
)

func hmacHex(t *testing.T, secret, message string) string {
	t.Helper()
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(message))
	return "sha256=" + hex.EncodeToString(mac.Sum(nil))
}

// TestCanonicalV1IsFrozen pins the exact bytes an un-upgraded edge signs. If
// this fails, every request from an edge that has not been redeployed is about
// to be rejected.
func TestCanonicalV1IsFrozen(t *testing.T) {
	id := identity{projectID: "42", userID: "7", tenantID: "tenant-a"}
	if got, want := id.canonical(signatureVersionV1), "v1\n42\n7\ntenant-a"; got != want {
		t.Fatalf("v1 canonical = %q, want %q", got, want)
	}
	// The execution id must not leak into the v1 string even when one is set:
	// an edge that has an execution id signs v2, and a v1 string that changed
	// shape would break every peer still on v1.
	withExec := identity{projectID: "42", userID: "7", tenantID: "tenant-a", executionID: "exec-9"}
	if got, want := withExec.canonical(signatureVersionV1), "v1\n42\n7\ntenant-a"; got != want {
		t.Fatalf("v1 canonical with an execution id = %q, want %q", got, want)
	}
}

// TestCanonicalV2AppendsExecutionID pins the v2 shape: v1's fields, in the same
// order, plus one newline-separated field.
func TestCanonicalV2AppendsExecutionID(t *testing.T) {
	id := identity{projectID: "42", userID: "7", tenantID: "tenant-a", executionID: "exec-9"}
	if got, want := id.canonical(signatureVersionV2), "v2\n42\n7\ntenant-a\nexec-9"; got != want {
		t.Fatalf("v2 canonical = %q, want %q", got, want)
	}
}

// TestFrozenDigestsMatchTheCanonicalStrings is the cross-module anchor: the two
// literals above are what elitea-main must produce. Recomputing them here from
// the canonical strings (rather than from sign()) keeps the check independent
// of the signing helper.
func TestFrozenDigestsMatchTheCanonicalStrings(t *testing.T) {
	if got := hmacHex(t, frozenSecret, "v1\n42\n7\ntenant-a"); got != frozenV1Digest {
		t.Fatalf("frozen v1 digest is stale: computed %s, literal %s", got, frozenV1Digest)
	}
	if got := hmacHex(t, frozenSecret, "v2\n42\n7\ntenant-a\nexec-9"); got != frozenV2Digest {
		t.Fatalf("frozen v2 digest is stale: computed %s, literal %s", got, frozenV2Digest)
	}
}

// TestVerifySignature_AcceptsV1FromAnUnupgradedEdge is the rollout guarantee in
// one direction: an edge that has not been redeployed signs the v1 tuple and
// sends no execution-id header, and this gateway must still serve it.
func TestVerifySignature_AcceptsV1FromAnUnupgradedEdge(t *testing.T) {
	h := http.Header{}
	h.Set(headerProjectID, "42")
	h.Set(headerUserID, "7")
	h.Set(headerTenantID, "tenant-a")
	h.Set(headerSignature, frozenV1Digest)

	if !verifySignature(h, []byte(frozenSecret)) {
		t.Fatal("a v1-signed request must still verify; rejecting it fails every request during a rolling deploy")
	}
}

// TestVerifySignature_AcceptsV2WithAnExecutionID is the other half: the new
// scheme verifies, execution id included.
func TestVerifySignature_AcceptsV2WithAnExecutionID(t *testing.T) {
	h := http.Header{}
	h.Set(headerProjectID, "42")
	h.Set(headerUserID, "7")
	h.Set(headerTenantID, "tenant-a")
	h.Set(headerExecutionID, "exec-9")
	h.Set(headerSignature, frozenV2Digest)

	if !verifySignature(h, []byte(frozenSecret)) {
		t.Fatal("a v2-signed request carrying an execution id must verify")
	}
}

// TestVerifySignature_RefusesAV1SignatureBesideAnExecutionID is the reason the
// acceptance is asymmetric.
//
// The v1 canonical string does not cover the execution id. If a v1 signature
// were accepted alongside the header, anything able to replay one could staple
// an arbitrary execution id onto it — and the whole point of putting the id in
// the signed tuple is that a caller cannot.
func TestVerifySignature_RefusesAV1SignatureBesideAnExecutionID(t *testing.T) {
	h := http.Header{}
	h.Set(headerProjectID, "42")
	h.Set(headerUserID, "7")
	h.Set(headerTenantID, "tenant-a")
	h.Set(headerSignature, frozenV1Digest)  // valid v1 signature …
	h.Set(headerExecutionID, "exec-forged") // … with an id it does not cover

	if verifySignature(h, []byte(frozenSecret)) {
		t.Fatal("a v1 signature must not authenticate an execution id it does not cover")
	}
}

// TestVerifySignature_RefusesATamperedExecutionID: the id is inside the MAC, so
// changing it after signing invalidates the request rather than silently
// re-attributing it to another agent.
func TestVerifySignature_RefusesATamperedExecutionID(t *testing.T) {
	h := http.Header{}
	SignIdentityHeaders(h, []byte(frozenSecret), "42", "7", "tenant-a", "exec-9")
	if !verifySignature(h, []byte(frozenSecret)) {
		t.Fatal("the signer and the verifier disagree")
	}

	h.Set(headerExecutionID, "exec-somebody-elses")
	if verifySignature(h, []byte(frozenSecret)) {
		t.Fatal("a tampered execution id must fail verification")
	}
}

// TestSignIdentityHeaders_ChoosesTheVersionByPresence: no execution id means a
// v1 signature, which is what keeps every existing caller compatible with a
// gateway that has not been upgraded.
func TestSignIdentityHeaders_ChoosesTheVersionByPresence(t *testing.T) {
	withoutExec := http.Header{}
	SignIdentityHeaders(withoutExec, []byte(frozenSecret), "42", "7", "tenant-a", "")
	if got := withoutExec.Get(headerSignature); got != frozenV1Digest {
		t.Fatalf("a request with no execution id must sign v1: got %s, want %s", got, frozenV1Digest)
	}
	if withoutExec.Get(headerExecutionID) != "" {
		t.Fatal("an empty execution id must not set the header")
	}

	withExec := http.Header{}
	SignIdentityHeaders(withExec, []byte(frozenSecret), "42", "7", "tenant-a", "exec-9")
	if got := withExec.Get(headerSignature); got != frozenV2Digest {
		t.Fatalf("a request carrying an execution id must sign v2: got %s, want %s", got, frozenV2Digest)
	}
	if got := withExec.Get(headerExecutionID); got != "exec-9" {
		t.Fatalf("execution id header = %q, want exec-9", got)
	}
}
