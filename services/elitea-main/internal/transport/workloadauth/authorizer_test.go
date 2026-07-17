package workloadauth

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"net"
	"net/url"
	"testing"

	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/peer"
)

type sessionVerifierStub struct {
	want  SessionBinding
	got   SessionBinding
	calls int
	err   error
}

func (s *sessionVerifierStub) VerifyActiveSession(_ context.Context, binding SessionBinding) error {
	s.calls++
	s.got = binding
	if binding != s.want {
		return errors.New("binding mismatch")
	}
	return s.err
}

func TestPeerAuthorizerBindsVerifiedSPIFFEPeerToPersistedSession(t *testing.T) {
	want := SessionBinding{
		WorkloadIdentity:  "spiffe://elitea.example/runtime/python-worker",
		WorkloadSessionID: "session-1",
		ProducerID:        "producer-1",
	}
	sessions := &sessionVerifierStub{want: want}
	authorizer, err := NewPeerAuthorizer(sessions)
	if err != nil {
		t.Fatal(err)
	}
	identity, err := authorizer.AuthorizeWorkload(peerContext(spiffeCertificate(t, want.WorkloadIdentity)), want.WorkloadSessionID, want.ProducerID)
	if err != nil {
		t.Fatal(err)
	}
	if identity != want.WorkloadIdentity || sessions.got != want || sessions.calls != 1 {
		t.Fatalf("authorization identity=%q binding=%+v calls=%d", identity, sessions.got, sessions.calls)
	}
}

func TestPeerAuthorizerAcceptsOneVerifiedDNSIdentity(t *testing.T) {
	want := SessionBinding{WorkloadIdentity: "dns:worker.runtime.example", WorkloadSessionID: "session-1", ProducerID: "producer-1"}
	sessions := &sessionVerifierStub{want: want}
	authorizer, err := NewPeerAuthorizer(sessions)
	if err != nil {
		t.Fatal(err)
	}
	certificate := &x509.Certificate{DNSNames: []string{"Worker.Runtime.Example"}}
	identity, err := authorizer.AuthorizeOutput(peerContext(certificate), want.WorkloadSessionID, want.ProducerID)
	if err != nil {
		t.Fatal(err)
	}
	if identity != want.WorkloadIdentity {
		t.Fatalf("identity = %q, want %q", identity, want.WorkloadIdentity)
	}
}

func TestPeerAuthorizerRejectsUnverifiedAmbiguousAndUnboundPeers(t *testing.T) {
	validURI := spiffeCertificate(t, "spiffe://elitea.example/runtime/python-worker")
	tests := []struct {
		name     string
		ctx      context.Context
		sessions *sessionVerifierStub
	}{
		{name: "no peer", ctx: context.Background(), sessions: &sessionVerifierStub{}},
		{name: "non TLS peer", ctx: peer.NewContext(context.Background(), &peer.Peer{AuthInfo: fakeAuthInfo{}}), sessions: &sessionVerifierStub{}},
		{name: "unverified certificate", ctx: peer.NewContext(context.Background(), &peer.Peer{AuthInfo: credentials.TLSInfo{State: tls.ConnectionState{PeerCertificates: []*x509.Certificate{validURI}}}}), sessions: &sessionVerifierStub{}},
		{name: "mixed URI and DNS SAN", ctx: peerContext(&x509.Certificate{URIs: validURI.URIs, DNSNames: []string{"worker.example"}}), sessions: &sessionVerifierStub{}},
		{name: "multiple URI SAN", ctx: peerContext(&x509.Certificate{URIs: []*url.URL{validURI.URIs[0], validURI.URIs[0]}}), sessions: &sessionVerifierStub{}},
		{name: "URI and email SAN", ctx: peerContext(&x509.Certificate{URIs: validURI.URIs, EmailAddresses: []string{"worker@example.test"}}), sessions: &sessionVerifierStub{}},
		{name: "DNS and IP SAN", ctx: peerContext(&x509.Certificate{DNSNames: []string{"worker.example"}, IPAddresses: []net.IP{net.ParseIP("192.0.2.1")}}), sessions: &sessionVerifierStub{}},
		{name: "wildcard DNS SAN", ctx: peerContext(&x509.Certificate{DNSNames: []string{"*.runtime.example"}}), sessions: &sessionVerifierStub{}},
		{name: "revoked or mismatched durable session", ctx: peerContext(validURI), sessions: &sessionVerifierStub{want: SessionBinding{WorkloadIdentity: validURI.URIs[0].String(), WorkloadSessionID: "session-1", ProducerID: "producer-1"}, err: errors.New("revoked")}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			authorizer, err := NewPeerAuthorizer(test.sessions)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := authorizer.AuthorizeWorkload(test.ctx, "session-1", "producer-1"); !errors.Is(err, ErrWorkloadUnauthorized) {
				t.Fatalf("error = %v, want unauthorized", err)
			}
		})
	}
}

type fakeAuthInfo struct{}

func (fakeAuthInfo) AuthType() string { return "fake" }

func peerContext(certificate *x509.Certificate) context.Context {
	return peer.NewContext(context.Background(), &peer.Peer{AuthInfo: credentials.TLSInfo{State: tls.ConnectionState{VerifiedChains: [][]*x509.Certificate{{certificate}}}}})
}

func spiffeCertificate(t *testing.T, raw string) *x509.Certificate {
	t.Helper()
	identity, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return &x509.Certificate{URIs: []*url.URL{identity}}
}
