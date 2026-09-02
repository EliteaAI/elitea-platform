package main

import (
	"strings"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/mailer"
)

func lookupOf(values map[string]string) func(string) (string, bool) {
	return func(name string) (string, bool) {
		v, ok := values[name]
		return v, ok
	}
}

func TestMailerConfigFromEnv(t *testing.T) {
	t.Run("unset is disabled and keeps the public URL", func(t *testing.T) {
		got, err := mailerConfigFromEnv(lookupOf(map[string]string{"DEPLOYMENT_URL": "https://ai.acme.example"}))
		if err != nil || got.Enabled || got.PublicBaseURL != "https://ai.acme.example" {
			t.Fatalf("got %+v, %v", got, err)
		}
	})
	t.Run("complete", func(t *testing.T) {
		got, err := mailerConfigFromEnv(lookupOf(map[string]string{
			"SMTP_HOST": "smtp.acme.example", "SMTP_PORT": "465", "SMTP_TLS": "implicit",
			"SMTP_USERNAME": "u", "SMTP_PASSWORD": "p",
			"EMAIL_FROM": "Acme <noreply@acme.example>", "EMAIL_REPLY_TO": "help@acme.example",
			"PUBLIC_BASE_URL": "https://ai.acme.example/",
		}))
		if err != nil || !got.Enabled {
			t.Fatalf("got %+v, %v", got, err)
		}
		if got.Transport.Port != 465 || got.Transport.TLS != mailer.TLSImplicit || got.Transport.From.Address != "noreply@acme.example" ||
			got.Transport.From.Name != "Acme" || got.Transport.ReplyTo == nil || got.Transport.ReplyTo.Address != "help@acme.example" {
			t.Fatalf("transport = %+v", got.Transport)
		}
	})
	t.Run("suppressed", func(t *testing.T) {
		got, err := mailerConfigFromEnv(lookupOf(map[string]string{
			"SMTP_HOST": "h", "EMAIL_FROM": "n@e.example", "DEPLOYMENT_URL": "https://a.example", "ELITEA_EMAIL_SUPPRESS": "true",
		}))
		if err != nil || !got.Suppressed || !got.Enabled {
			t.Fatalf("got %+v, %v", got, err)
		}
	})
	t.Run("defaults are 587 starttls", func(t *testing.T) {
		got, err := mailerConfigFromEnv(lookupOf(map[string]string{
			"SMTP_HOST": "smtp.acme.example", "EMAIL_FROM": "noreply@acme.example", "DEPLOYMENT_URL": "https://a.example",
		}))
		if err != nil || got.Transport.Port != 587 || got.Transport.TLS != mailer.TLSStartTLS {
			t.Fatalf("got %+v, %v", got, err)
		}
	})
	for name, env := range map[string]map[string]string{
		"host without from":     {"SMTP_HOST": "h", "DEPLOYMENT_URL": "https://a.example"},
		"host without base url": {"SMTP_HOST": "h", "EMAIL_FROM": "n@e.example"},
		"port not a number":     {"SMTP_HOST": "h", "EMAIL_FROM": "n@e.example", "DEPLOYMENT_URL": "https://a.example", "SMTP_PORT": "smtp"},
		"unknown tls":           {"SMTP_HOST": "h", "EMAIL_FROM": "n@e.example", "DEPLOYMENT_URL": "https://a.example", "SMTP_TLS": "ssl"},
		"username alone":        {"SMTP_HOST": "h", "EMAIL_FROM": "n@e.example", "DEPLOYMENT_URL": "https://a.example", "SMTP_USERNAME": "u"},
		"bad from":              {"SMTP_HOST": "h", "EMAIL_FROM": "not an address", "DEPLOYMENT_URL": "https://a.example"},
		"password without host": {"SMTP_PASSWORD": "p"},
		"suppress not boolean":  {"ELITEA_EMAIL_SUPPRESS": "yes"},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := mailerConfigFromEnv(lookupOf(env)); err == nil {
				t.Fatal("accepted")
			} else if !strings.Contains(err.Error(), "SMTP") && !strings.Contains(err.Error(), "EMAIL") && !strings.Contains(err.Error(), "PUBLIC_BASE_URL") {
				t.Fatalf("error does not name the variable: %v", err)
			}
		})
	}
}
