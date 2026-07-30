package runtimegrpc

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"errors"
	"math/big"
	"net/url"
	"testing"
	"time"

	"google.golang.org/grpc/test/bufconn"
)

func TestRuntimeMutualTLSRotationOverlapAndCutover(t *testing.T) {
	serverCA := newRotationCA(t, "runtime server CA", 10)
	oldClientCA := newRotationCA(t, "runtime old client CA", 20)
	newClientCA := newRotationCA(t, "runtime new client CA", 30)
	serverCertificate := issueRotationCertificate(t, serverCA, 11, "runtime.internal.test", "", x509.ExtKeyUsageServerAuth)
	oldClientCertificate := issueRotationCertificate(t, oldClientCA, 21, "", "spiffe://elitea.test/runtime/worker-old", x509.ExtKeyUsageClientAuth)
	newClientCertificate := issueRotationCertificate(t, newClientCA, 31, "", "spiffe://elitea.test/runtime/worker-new", x509.ExtKeyUsageClientAuth)
	serverRoots := rotationRootPool(serverCA)

	oldRoots := rotationRootPool(oldClientCA)
	oldOnly, err := NewServerTLSConfig(serverCertificate, oldRoots)
	if err != nil {
		t.Fatal(err)
	}
	if err := runtimeMutualTLSHandshake(oldOnly, oldClientCertificate, serverRoots); err != nil {
		t.Fatalf("old certificate before rotation: %v", err)
	}
	if err := runtimeMutualTLSHandshake(oldOnly, newClientCertificate, serverRoots); err == nil {
		t.Fatal("new certificate was accepted before its CA entered the trust bundle")
	}

	// NewServerTLSConfig clones the trust pool and contains a static certificate.
	// Mutating source files or the source pool therefore does not hot-reload a
	// running listener; deployment must compose a new config and restart it.
	oldRoots.AddCert(newClientCA.certificate)
	if oldOnly.GetCertificate != nil || len(oldOnly.Certificates) != 1 {
		t.Fatal("runtime TLS config unexpectedly uses a live certificate callback")
	}
	if err := runtimeMutualTLSHandshake(oldOnly, newClientCertificate, serverRoots); err == nil {
		t.Fatal("source trust-pool mutation unexpectedly changed the running TLS config")
	}

	overlap, err := NewServerTLSConfig(serverCertificate, rotationRootPool(oldClientCA, newClientCA))
	if err != nil {
		t.Fatal(err)
	}
	if err := runtimeMutualTLSHandshake(overlap, oldClientCertificate, serverRoots); err != nil {
		t.Fatalf("old certificate during overlap: %v", err)
	}
	if err := runtimeMutualTLSHandshake(overlap, newClientCertificate, serverRoots); err != nil {
		t.Fatalf("new certificate during overlap: %v", err)
	}

	newOnly, err := NewServerTLSConfig(serverCertificate, rotationRootPool(newClientCA))
	if err != nil {
		t.Fatal(err)
	}
	if err := runtimeMutualTLSHandshake(newOnly, oldClientCertificate, serverRoots); err == nil {
		t.Fatal("old certificate remained trusted after cutover")
	}
	if err := runtimeMutualTLSHandshake(newOnly, newClientCertificate, serverRoots); err != nil {
		t.Fatalf("new certificate after cutover: %v", err)
	}
}

type rotationCA struct {
	certificate *x509.Certificate
	der         []byte
	privateKey  ed25519.PrivateKey
}

func newRotationCA(t *testing.T, commonName string, serial int64) rotationCA {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(serial),
		Subject:               pkix.Name{CommonName: commonName},
		NotBefore:             now.Add(-time.Hour),
		NotAfter:              now.Add(time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, publicKey, privateKey)
	if err != nil {
		t.Fatal(err)
	}
	certificate, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return rotationCA{certificate: certificate, der: der, privateKey: privateKey}
}

func issueRotationCertificate(t *testing.T, authority rotationCA, serial int64, dnsName, spiffeID string, usage x509.ExtKeyUsage) tls.Certificate {
	t.Helper()
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	template := &x509.Certificate{
		SerialNumber: big.NewInt(serial),
		Subject:      pkix.Name{CommonName: "ignored-common-name"},
		NotBefore:    now.Add(-time.Hour),
		NotAfter:     now.Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{usage},
	}
	if dnsName != "" {
		template.DNSNames = []string{dnsName}
	}
	if spiffeID != "" {
		identity, err := url.Parse(spiffeID)
		if err != nil {
			t.Fatal(err)
		}
		template.URIs = []*url.URL{identity}
	}
	der, err := x509.CreateCertificate(rand.Reader, template, authority.certificate, publicKey, authority.privateKey)
	if err != nil {
		t.Fatal(err)
	}
	return tls.Certificate{Certificate: [][]byte{der, authority.der}, PrivateKey: privateKey}
}

func rotationRootPool(authorities ...rotationCA) *x509.CertPool {
	pool := x509.NewCertPool()
	for _, authority := range authorities {
		pool.AddCert(authority.certificate)
	}
	return pool
}

func runtimeMutualTLSHandshake(serverConfig *tls.Config, clientCertificate tls.Certificate, serverRoots *x509.CertPool) error {
	listener := bufconn.Listen(1 << 20)
	defer func() { _ = listener.Close() }()
	deadline := time.Now().Add(2 * time.Second)
	serverResult := make(chan error, 1)
	go func() {
		connection, err := listener.Accept()
		if err != nil {
			serverResult <- err
			return
		}
		defer func() { _ = connection.Close() }()
		_ = connection.SetDeadline(deadline)
		serverResult <- tls.Server(connection, serverConfig.Clone()).Handshake()
	}()
	clientConnection, err := listener.Dial()
	if err != nil {
		return err
	}
	defer func() { _ = clientConnection.Close() }()
	_ = clientConnection.SetDeadline(deadline)
	client := tls.Client(clientConnection, &tls.Config{
		MinVersion:   tls.VersionTLS13,
		RootCAs:      serverRoots,
		Certificates: []tls.Certificate{clientCertificate},
		ServerName:   "runtime.internal.test",
		NextProtos:   []string{"h2"},
	})
	clientErr := client.Handshake()
	if clientErr != nil {
		// A rejected peer may have already stopped reading the alert sent by the
		// server. Closing the client makes rejection tests deterministic.
		_ = clientConnection.Close()
	}
	return errors.Join(clientErr, <-serverResult)
}
