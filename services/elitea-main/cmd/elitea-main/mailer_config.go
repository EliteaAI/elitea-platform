package main

import (
	"errors"
	"fmt"
	"net/mail"
	"strconv"
	"strings"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/mailer"
)

// mailerConfig is outbound e-mail (ADR-0024 WP7). Enabled is false when
// SMTP_HOST is unset: the deployment sends nothing and every invite reports
// `invitation_delivered: false`, exactly as before. Once SMTP_HOST is set the
// rest is REQUIRED — a half-configured mailer would report deliveries it
// never made, so it refuses to boot instead.
type mailerConfig struct {
	Enabled       bool
	Transport     mailer.Config
	PublicBaseURL string
	// Suppressed (ELITEA_EMAIL_SUPPRESS=true) renders but never sends: the
	// setting for a shadow or staging deployment that must produce no
	// user-visible side effect (spec-security-verification §shadow).
	Suppressed bool
}

// mailerConfigFromEnv reads SMTP_HOST, SMTP_PORT, SMTP_USERNAME,
// SMTP_PASSWORD, SMTP_TLS, EMAIL_FROM, EMAIL_REPLY_TO and PUBLIC_BASE_URL
// (falling back to DEPLOYMENT_URL, which the chart already declares).
func mailerConfigFromEnv(lookup func(string) (string, bool)) (mailerConfig, error) {
	if lookup == nil {
		return mailerConfig{}, errors.New("mailer environment lookup is required")
	}
	get := func(name string) string {
		value, _ := lookup(name)
		return strings.TrimSpace(value)
	}
	baseURL := get("PUBLIC_BASE_URL")
	if baseURL == "" {
		baseURL = get("DEPLOYMENT_URL")
	}
	suppressed := false
	switch get("ELITEA_EMAIL_SUPPRESS") {
	case "", "false":
	case "true":
		suppressed = true
	default:
		return mailerConfig{}, errors.New("ELITEA_EMAIL_SUPPRESS must be true or false")
	}
	host := get("SMTP_HOST")
	if host == "" {
		for _, name := range []string{"SMTP_PORT", "SMTP_USERNAME", "SMTP_PASSWORD", "EMAIL_FROM", "EMAIL_REPLY_TO"} {
			if get(name) != "" {
				return mailerConfig{}, fmt.Errorf("%s is set but SMTP_HOST is not: set SMTP_HOST or unset the rest", name)
			}
		}
		return mailerConfig{PublicBaseURL: baseURL, Suppressed: suppressed}, nil
	}

	config := mailer.Config{Host: host, Port: 587, TLS: mailer.TLSStartTLS}
	if raw := get("SMTP_PORT"); raw != "" {
		port, err := strconv.Atoi(raw)
		if err != nil || port <= 0 || port > 65535 {
			return mailerConfig{}, fmt.Errorf("SMTP_PORT must be a port number, got %q", raw)
		}
		config.Port = port
	}
	switch mode := mailer.TLSMode(strings.ToLower(get("SMTP_TLS"))); mode {
	case "":
	case mailer.TLSStartTLS, mailer.TLSImplicit, mailer.TLSNone:
		config.TLS = mode
	default:
		return mailerConfig{}, fmt.Errorf("SMTP_TLS must be starttls, implicit or none, got %q", mode)
	}
	config.Username = get("SMTP_USERNAME")
	config.Password = get("SMTP_PASSWORD")
	if (config.Username == "") != (config.Password == "") {
		return mailerConfig{}, errors.New("SMTP_USERNAME and SMTP_PASSWORD must be set together")
	}
	from := get("EMAIL_FROM")
	if from == "" {
		return mailerConfig{}, errors.New("EMAIL_FROM is required when SMTP_HOST is set")
	}
	fromAddress, err := mail.ParseAddress(from)
	if err != nil {
		return mailerConfig{}, fmt.Errorf("EMAIL_FROM must be an address such as noreply@example.com, got %q", from)
	}
	config.From = *fromAddress
	if replyTo := get("EMAIL_REPLY_TO"); replyTo != "" {
		replyAddress, err := mail.ParseAddress(replyTo)
		if err != nil {
			return mailerConfig{}, fmt.Errorf("EMAIL_REPLY_TO must be an address, got %q", replyTo)
		}
		config.ReplyTo = replyAddress
	}
	if baseURL == "" {
		return mailerConfig{}, errors.New("PUBLIC_BASE_URL (or DEPLOYMENT_URL) is required when SMTP_HOST is set: e-mail links and the logo need an absolute origin")
	}
	return mailerConfig{Enabled: true, Transport: config, PublicBaseURL: baseURL, Suppressed: suppressed}, nil
}
