// Package browserauth implements the unversioned browser authentication HTTP
// boundary. It remains unmounted until its production dependencies and gateway
// tests are complete.
package browserauth

import (
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
	"time"
)

const (
	CookieValuePrefix    = "v1."
	SessionIDRandomBytes = 32
	minCookieLifetime    = time.Minute
	maxCookieLifetime    = 30 * 24 * time.Hour
	maxCookieNameBytes   = 128
	maxCookieDomainBytes = 253
)

var (
	ErrInvalidCookiePolicy  = errors.New("invalid browser session cookie policy")
	ErrSessionCookieMissing = errors.New("browser session cookie is missing")
	ErrSessionCookieInvalid = errors.New("browser session cookie is invalid")
)

// CookieConfig is deliberately smaller than the current Flask configuration.
// Path is always root, HttpOnly is always enabled, and the value is always a
// versioned opaque server-side session ID. Development permits an insecure
// cookie only for an explicitly local HTTP environment.
type CookieConfig struct {
	Name        string
	Domain      string
	Secure      bool
	SameSite    http.SameSite
	Lifetime    time.Duration
	Development bool
}

type CookiePolicy struct {
	name     string
	domain   string
	secure   bool
	sameSite http.SameSite
	lifetime time.Duration
	now      func() time.Time
}

func NewCookiePolicy(config CookieConfig) (*CookiePolicy, error) {
	return newCookiePolicy(config, time.Now)
}

func newCookiePolicy(config CookieConfig, now func() time.Time) (*CookiePolicy, error) {
	if now == nil || len(config.Name) == 0 || len(config.Name) > maxCookieNameBytes ||
		len(config.Domain) > maxCookieDomainBytes || config.Lifetime < minCookieLifetime ||
		config.Lifetime > maxCookieLifetime || config.Lifetime%time.Second != 0 {
		return nil, ErrInvalidCookiePolicy
	}
	if !config.Secure && !config.Development {
		return nil, ErrInvalidCookiePolicy
	}
	switch config.SameSite {
	case http.SameSiteLaxMode, http.SameSiteStrictMode:
	case http.SameSiteNoneMode:
		if !config.Secure {
			return nil, ErrInvalidCookiePolicy
		}
	default:
		return nil, ErrInvalidCookiePolicy
	}

	probe := &http.Cookie{
		Name:     config.Name,
		Value:    CookieValuePrefix + strings.Repeat("A", 43),
		Path:     "/",
		Domain:   config.Domain,
		Secure:   config.Secure,
		HttpOnly: true,
		SameSite: config.SameSite,
	}
	if probe.Valid() != nil {
		return nil, ErrInvalidCookiePolicy
	}

	return &CookiePolicy{
		name:     config.Name,
		domain:   config.Domain,
		secure:   config.Secure,
		sameSite: config.SameSite,
		lifetime: config.Lifetime,
		now:      now,
	}, nil
}

// Read returns exactly one current-version canonical 256-bit session ID.
// Current Flask/Pickle cookies and future versions fail closed; cutover must
// explicitly choose forced reauthentication or a separate compatibility
// reader before this boundary is mounted.
func (p *CookiePolicy) Read(request *http.Request) (string, error) {
	if p == nil || request == nil {
		return "", ErrSessionCookieInvalid
	}
	cookies := request.CookiesNamed(p.name)
	if len(cookies) == 0 {
		return "", ErrSessionCookieMissing
	}
	if len(cookies) != 1 {
		return "", ErrSessionCookieInvalid
	}
	value := cookies[0].Value
	if !strings.HasPrefix(value, CookieValuePrefix) {
		return "", ErrSessionCookieInvalid
	}
	sessionID := strings.TrimPrefix(value, CookieValuePrefix)
	if !validSessionID(sessionID) {
		return "", ErrSessionCookieInvalid
	}
	return sessionID, nil
}

func (p *CookiePolicy) Set(writer http.ResponseWriter, sessionID string) error {
	if p == nil || writer == nil || !validSessionID(sessionID) {
		return ErrSessionCookieInvalid
	}
	http.SetCookie(writer, p.cookie(
		CookieValuePrefix+sessionID,
		int(p.lifetime/time.Second),
		p.now().UTC().Add(p.lifetime),
	))
	return nil
}

// Clear uses the same name, path, domain, Secure, HttpOnly, and SameSite
// attributes as Set. That exact match is required for reliable invalidation.
func (p *CookiePolicy) Clear(writer http.ResponseWriter) error {
	if p == nil || writer == nil {
		return ErrInvalidCookiePolicy
	}
	http.SetCookie(writer, p.cookie("", -1, time.Unix(1, 0).UTC()))
	return nil
}

func (p *CookiePolicy) cookie(value string, maxAge int, expires time.Time) *http.Cookie {
	return &http.Cookie{
		Name:     p.name,
		Value:    value,
		Path:     "/",
		Domain:   p.domain,
		Expires:  expires,
		MaxAge:   maxAge,
		Secure:   p.secure,
		HttpOnly: true,
		SameSite: p.sameSite,
	}
}

func validSessionID(sessionID string) bool {
	decoded, err := base64.RawURLEncoding.DecodeString(sessionID)
	return err == nil && len(decoded) == SessionIDRandomBytes &&
		base64.RawURLEncoding.EncodeToString(decoded) == sessionID
}
