package workloadidentity

import (
	"crypto/x509"
	"crypto/x509/pkix"
	"errors"
	"net"
	"net/url"
	"testing"
)

func TestCertificateCanonicalIdentity(t *testing.T) {
	spiffeID := mustURL(t, "spiffe://elitea.example/runtime/python-worker")
	tests := []struct {
		name        string
		certificate *x509.Certificate
		want        string
	}{
		{
			name:        "SPIFFE URI SAN",
			certificate: &x509.Certificate{URIs: []*url.URL{spiffeID}},
			want:        spiffeID.String(),
		},
		{
			name:        "DNS SAN",
			certificate: &x509.Certificate{DNSNames: []string{"Worker.Runtime.Example"}},
			want:        "dns:worker.runtime.example",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := Certificate(test.certificate)
			if err != nil {
				t.Fatal(err)
			}
			if got != test.want {
				t.Fatalf("Certificate() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestCertificateRejectsAmbiguousOrInvalidIdentity(t *testing.T) {
	spiffeID := mustURL(t, "spiffe://elitea.example/runtime/python-worker")
	tests := []struct {
		name        string
		certificate *x509.Certificate
	}{
		{name: "nil certificate"},
		{name: "CommonName only", certificate: &x509.Certificate{Subject: subject("worker.example")}},
		{name: "URI and DNS SAN", certificate: &x509.Certificate{URIs: []*url.URL{spiffeID}, DNSNames: []string{"worker.example"}}},
		{name: "multiple URI SANs", certificate: &x509.Certificate{URIs: []*url.URL{spiffeID, spiffeID}}},
		{name: "email SAN", certificate: &x509.Certificate{URIs: []*url.URL{spiffeID}, EmailAddresses: []string{"worker@example.test"}}},
		{name: "IP SAN", certificate: &x509.Certificate{DNSNames: []string{"worker.example"}, IPAddresses: []net.IP{net.ParseIP("192.0.2.1")}}},
		{name: "wildcard DNS SAN", certificate: &x509.Certificate{DNSNames: []string{"*.runtime.example"}}},
		{name: "IP encoded as DNS SAN", certificate: &x509.Certificate{DNSNames: []string{"192.0.2.1"}}},
		{name: "non ASCII DNS SAN", certificate: &x509.Certificate{DNSNames: []string{"wörker.example"}}},
		{name: "SPIFFE root path", certificate: &x509.Certificate{URIs: []*url.URL{mustURL(t, "spiffe://elitea.example/")}}},
		{name: "SPIFFE query", certificate: &x509.Certificate{URIs: []*url.URL{mustURL(t, "spiffe://elitea.example/runtime/worker?role=indexer")}}},
		{name: "SPIFFE fragment", certificate: &x509.Certificate{URIs: []*url.URL{mustURL(t, "spiffe://elitea.example/runtime/worker#fragment")}}},
		{name: "non SPIFFE URI", certificate: &x509.Certificate{URIs: []*url.URL{mustURL(t, "https://elitea.example/runtime/worker")}}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := Certificate(test.certificate); !errors.Is(err, ErrInvalidCertificateIdentity) {
				t.Fatalf("Certificate() error = %v, want %v", err, ErrInvalidCertificateIdentity)
			}
		})
	}
}

func mustURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	value, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	return value
}

func subject(commonName string) (subject pkix.Name) {
	subject.CommonName = commonName
	return subject
}
