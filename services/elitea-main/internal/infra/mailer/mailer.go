// Package mailer is the SMTP transport for outbound e-mail (ADR-0024 WP7).
//
// The platform sent no e-mail before this package: there was no client, no
// template and no configuration in Go, in the legacy tree or in the chart.
// This is the transport half — dial, authenticate, submit one message — and
// deliberately nothing else. What a message SAYS, and the brand it carries,
// is `internal/application/mailer`'s job.
//
// # Configured, unconfigured, half-configured
//
// A deployment with no SMTP_HOST sends nothing and behaves exactly as before
// (NullTransport). A deployment with SMTP_HOST but, say, no EMAIL_FROM is
// refused at boot (cmd/elitea-main/mailer_config.go): a mailer that is half
// configured would report every invitation as delivered while delivering
// none, which is the defect the `invitation_delivered` field was added to
// prevent.
//
// # TLS
//
// Three modes: `starttls` (port 587, the default — connect in the clear,
// upgrade before any credential is sent, refuse to continue if the server
// declines), `implicit` (port 465, TLS from the first byte) and `none`
// (tests and an in-cluster relay only). The server certificate is verified
// against the system roots in both TLS modes; there is no switch to skip it.
package mailer

import (
	"bytes"
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"mime"
	"mime/multipart"
	"net"
	"net/mail"
	"net/smtp"
	"net/textproto"
	"strconv"
	"strings"
	"time"
)

// TLSMode selects how the SMTP session is secured.
type TLSMode string

const (
	TLSStartTLS TLSMode = "starttls"
	TLSImplicit TLSMode = "implicit"
	TLSNone     TLSMode = "none"
)

// Config wires an SMTPTransport.
type Config struct {
	Host     string
	Port     int
	Username string
	Password string
	TLS      TLSMode
	// From is the envelope sender and the default header sender.
	From mail.Address
	// ReplyTo is optional.
	ReplyTo *mail.Address
	// Timeout bounds the whole session; zero means DefaultTimeout.
	Timeout time.Duration
}

// DefaultTimeout bounds one SMTP session end to end.
const DefaultTimeout = 20 * time.Second

// Message is one outbound e-mail: a text alternative is required, HTML is
// optional. Both are UTF-8.
type Message struct {
	To      mail.Address
	Subject string
	Text    string
	HTML    string
	// FromName overrides the configured sender's display name (the brand's
	// sender name); the address itself never changes.
	FromName string
}

// Transport submits messages.
type Transport interface {
	Send(ctx context.Context, message Message) error
}

// ErrNotConfigured is what NullTransport answers.
var ErrNotConfigured = errors.New("outbound e-mail is not configured")

// NullTransport sends nothing and says so.
type NullTransport struct{}

func (NullTransport) Send(context.Context, Message) error { return ErrNotConfigured }

// SMTPTransport submits over one SMTP session per message.
type SMTPTransport struct {
	config Config
	// dial is injectable so the session logic is testable against an
	// in-process server.
	dial func(ctx context.Context, address string) (net.Conn, error)
}

// New validates the configuration and returns a transport.
func New(config Config) (*SMTPTransport, error) {
	if strings.TrimSpace(config.Host) == "" {
		return nil, errors.New("mailer: host is required")
	}
	if config.Port <= 0 || config.Port > 65535 {
		return nil, fmt.Errorf("mailer: port %d is out of range", config.Port)
	}
	if config.From.Address == "" {
		return nil, errors.New("mailer: sender address is required")
	}
	switch config.TLS {
	case TLSStartTLS, TLSImplicit, TLSNone:
	case "":
		config.TLS = TLSStartTLS
	default:
		return nil, fmt.Errorf("mailer: unknown TLS mode %q", config.TLS)
	}
	if (config.Username == "") != (config.Password == "") {
		return nil, errors.New("mailer: username and password must be set together")
	}
	if config.Timeout <= 0 {
		config.Timeout = DefaultTimeout
	}
	transport := &SMTPTransport{config: config}
	transport.dial = func(ctx context.Context, address string) (net.Conn, error) {
		var dialer net.Dialer
		return dialer.DialContext(ctx, "tcp", address)
	}
	return transport, nil
}

// Send submits one message. Every failure names the stage it failed at.
func (t *SMTPTransport) Send(ctx context.Context, message Message) error {
	if message.To.Address == "" {
		return errors.New("mailer: recipient address is required")
	}
	if strings.TrimSpace(message.Text) == "" {
		return errors.New("mailer: a text body is required")
	}
	ctx, cancel := context.WithTimeout(ctx, t.config.Timeout)
	defer cancel()

	address := net.JoinHostPort(t.config.Host, strconv.Itoa(t.config.Port))
	conn, err := t.dial(ctx, address)
	if err != nil {
		return fmt.Errorf("mailer: connect %s: %w", address, err)
	}
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}
	tlsConfig := &tls.Config{ServerName: t.config.Host, MinVersion: tls.VersionTLS12}
	if t.config.TLS == TLSImplicit {
		conn = tls.Client(conn, tlsConfig)
	}
	client, err := smtp.NewClient(conn, t.config.Host)
	if err != nil {
		_ = conn.Close()
		return fmt.Errorf("mailer: greeting: %w", err)
	}
	defer func() { _ = client.Close() }()

	if t.config.TLS == TLSStartTLS {
		if ok, _ := client.Extension("STARTTLS"); !ok {
			return errors.New("mailer: server does not offer STARTTLS; set SMTP_TLS=implicit or none deliberately")
		}
		if err := client.StartTLS(tlsConfig); err != nil {
			return fmt.Errorf("mailer: STARTTLS: %w", err)
		}
	}
	if t.config.Username != "" {
		if ok, _ := client.Extension("AUTH"); !ok {
			return errors.New("mailer: server offers no AUTH but credentials are configured")
		}
		auth := smtp.PlainAuth("", t.config.Username, t.config.Password, t.config.Host)
		if t.config.TLS == TLSNone {
			// net/smtp refuses PLAIN over a clear connection unless the server
			// is localhost; a relay that wants it in the clear is a
			// misconfiguration this transport will not paper over.
			auth = plainOverClear{auth}
		}
		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("mailer: AUTH: %w", err)
		}
	}
	if err := client.Mail(t.config.From.Address); err != nil {
		return fmt.Errorf("mailer: MAIL FROM: %w", err)
	}
	if err := client.Rcpt(message.To.Address); err != nil {
		return fmt.Errorf("mailer: RCPT TO: %w", err)
	}
	writer, err := client.Data()
	if err != nil {
		return fmt.Errorf("mailer: DATA: %w", err)
	}
	if _, err := writer.Write(t.encode(message)); err != nil {
		_ = writer.Close()
		return fmt.Errorf("mailer: body: %w", err)
	}
	if err := writer.Close(); err != nil {
		return fmt.Errorf("mailer: end of data: %w", err)
	}
	return client.Quit()
}

// plainOverClear lets PLAIN run without TLS for TLSNone; net/smtp's PlainAuth
// otherwise refuses the exchange on a non-TLS connection to a non-localhost
// host, which is right for production and wrong for the mode that exists for
// an in-cluster relay.
type plainOverClear struct{ smtp.Auth }

func (a plainOverClear) Start(server *smtp.ServerInfo) (string, []byte, error) {
	copied := *server
	copied.TLS = true
	return a.Auth.Start(&copied)
}

// Encode renders the RFC 5322 message: headers, then either a single
// text/plain part or a multipart/alternative with text first and HTML last
// (clients pick the last part they can render).
func (t *SMTPTransport) encode(message Message) []byte {
	return Encode(t.config.From, t.config.ReplyTo, message, time.Now())
}

// Encode is the pure encoder, exported for tests and for the composer's own
// preview.
func Encode(from mail.Address, replyTo *mail.Address, message Message, now time.Time) []byte {
	if message.FromName != "" {
		from = mail.Address{Name: message.FromName, Address: from.Address}
	}
	var out bytes.Buffer
	header := func(name, value string) {
		fmt.Fprintf(&out, "%s: %s\r\n", name, value)
	}
	header("From", from.String())
	header("To", message.To.String())
	if replyTo != nil && replyTo.Address != "" {
		header("Reply-To", replyTo.String())
	}
	header("Subject", mime.QEncoding.Encode("utf-8", strings.ReplaceAll(strings.ReplaceAll(message.Subject, "\r", " "), "\n", " ")))
	header("Date", now.UTC().Format(time.RFC1123Z))
	header("MIME-Version", "1.0")
	header("Auto-Submitted", "auto-generated")

	if message.HTML == "" {
		header("Content-Type", "text/plain; charset=utf-8")
		header("Content-Transfer-Encoding", "8bit")
		out.WriteString("\r\n")
		out.WriteString(dotStuffLines(message.Text))
		return out.Bytes()
	}

	var body bytes.Buffer
	parts := multipart.NewWriter(&body)
	header("Content-Type", "multipart/alternative; boundary="+strconv.Quote(parts.Boundary()))
	out.WriteString("\r\n")
	for _, part := range []struct{ contentType, content string }{
		{"text/plain; charset=utf-8", message.Text},
		{"text/html; charset=utf-8", message.HTML},
	} {
		w, _ := parts.CreatePart(textproto.MIMEHeader{
			"Content-Type":              {part.contentType},
			"Content-Transfer-Encoding": {"8bit"},
		})
		_, _ = w.Write([]byte(dotStuffLines(part.content)))
	}
	_ = parts.Close()
	out.Write(body.Bytes())
	return out.Bytes()
}

// dotStuffLines normalises line endings to CRLF. net/smtp's DATA writer
// performs the dot-stuffing itself; only the line endings are this
// function's concern, so a body assembled with \n on one platform and \r\n
// on another encodes identically.
func dotStuffLines(text string) string {
	text = strings.ReplaceAll(text, "\r\n", "\n")
	return strings.ReplaceAll(text, "\n", "\r\n")
}
