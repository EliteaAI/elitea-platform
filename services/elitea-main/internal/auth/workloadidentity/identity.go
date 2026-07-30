// Package workloadidentity extracts one canonical identity from a verified
// workload certificate. It never falls back to CommonName.
package workloadidentity

import (
	"crypto/x509"
	"errors"
	"net"
	"net/url"
	"strings"
)

var ErrInvalidCertificateIdentity = errors.New("invalid workload certificate identity")

// Certificate accepts exactly one SPIFFE URI SAN or one exact DNS SAN. Mixed
// or multiple identity SANs, including email and IP SANs, are ambiguous and
// rejected.
func Certificate(certificate *x509.Certificate) (string, error) {
	if certificate == nil {
		return "", ErrInvalidCertificateIdentity
	}
	if len(certificate.EmailAddresses) != 0 || len(certificate.IPAddresses) != 0 {
		return "", ErrInvalidCertificateIdentity
	}
	if len(certificate.URIs) == 1 && len(certificate.DNSNames) == 0 {
		return spiffe(certificate.URIs[0])
	}
	if len(certificate.URIs) == 0 && len(certificate.DNSNames) == 1 {
		name := strings.ToLower(strings.TrimSuffix(certificate.DNSNames[0], "."))
		if name == "" || strings.ContainsAny(name, "*\r\n\x00") || net.ParseIP(name) != nil || certificate.VerifyHostname(name) != nil {
			return "", ErrInvalidCertificateIdentity
		}
		for _, character := range name {
			if character > 0x7f {
				return "", ErrInvalidCertificateIdentity
			}
		}
		return "dns:" + name, nil
	}
	return "", ErrInvalidCertificateIdentity
}

func spiffe(identity *url.URL) (string, error) {
	if identity == nil || identity.Scheme != "spiffe" || identity.Host == "" || identity.Path == "" || identity.Path == "/" || identity.User != nil || identity.Fragment != "" || identity.RawQuery != "" || identity.RawPath != "" {
		return "", ErrInvalidCertificateIdentity
	}
	canonical := identity.String()
	if len(canonical) > 512 || strings.ContainsAny(canonical, "\r\n\x00") {
		return "", ErrInvalidCertificateIdentity
	}
	return canonical, nil
}
