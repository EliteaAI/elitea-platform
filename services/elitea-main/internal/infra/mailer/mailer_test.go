package mailer

import (
	"bufio"
	"context"
	"encoding/base64"
	"errors"
	"net"
	"net/mail"
	"strings"
	"sync"
	"testing"
	"time"
)

// smtpStub is a minimal SMTP server: EHLO, AUTH PLAIN, MAIL, RCPT, DATA, QUIT.
// It records what the client sent so the test can assert the envelope and
// the encoded message end to end, over a real socket.
type smtpStub struct {
	listener  net.Listener
	offerAuth bool

	mu       sync.Mutex
	authLine string
	from, to string
	data     string
	sessions int
}

func newSMTPStub(t *testing.T, offerAuth bool) *smtpStub {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	stub := &smtpStub{listener: listener, offerAuth: offerAuth}
	go stub.serve()
	t.Cleanup(func() { _ = listener.Close() })
	return stub
}

func (s *smtpStub) address() string { return s.listener.Addr().String() }

func (s *smtpStub) serve() {
	for {
		conn, err := s.listener.Accept()
		if err != nil {
			return
		}
		go s.session(conn)
	}
}

func (s *smtpStub) session(conn net.Conn) {
	defer func() { _ = conn.Close() }()
	s.mu.Lock()
	s.sessions++
	s.mu.Unlock()
	reader := bufio.NewReader(conn)
	write := func(line string) { _, _ = conn.Write([]byte(line + "\r\n")) }
	write("220 stub ESMTP")
	inData := false
	var data strings.Builder
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return
		}
		line = strings.TrimRight(line, "\r\n")
		if inData {
			if line == "." {
				inData = false
				s.mu.Lock()
				s.data = data.String()
				s.mu.Unlock()
				write("250 queued")
				continue
			}
			data.WriteString(strings.TrimPrefix(line, ".") + "\r\n")
			continue
		}
		upper := strings.ToUpper(line)
		switch {
		case strings.HasPrefix(upper, "EHLO"):
			write("250-stub")
			if s.offerAuth {
				write("250-AUTH PLAIN")
			}
			write("250 8BITMIME")
		case strings.HasPrefix(upper, "AUTH PLAIN"):
			s.mu.Lock()
			s.authLine = strings.TrimSpace(line[len("AUTH PLAIN"):])
			s.mu.Unlock()
			write("235 ok")
		case strings.HasPrefix(upper, "MAIL FROM:"):
			s.mu.Lock()
			s.from = line[len("MAIL FROM:"):]
			s.mu.Unlock()
			write("250 ok")
		case strings.HasPrefix(upper, "RCPT TO:"):
			s.mu.Lock()
			s.to = line[len("RCPT TO:"):]
			s.mu.Unlock()
			write("250 ok")
		case upper == "DATA":
			inData = true
			write("354 go")
		case upper == "QUIT":
			write("221 bye")
			return
		default:
			write("250 ok")
		}
	}
}

func stubConfig(t *testing.T, stub *smtpStub, username, password string) Config {
	t.Helper()
	host, port, _ := net.SplitHostPort(stub.address())
	var portNumber int
	for _, ch := range port {
		portNumber = portNumber*10 + int(ch-'0')
	}
	replyTo := mail.Address{Name: "Support", Address: "support@acme.example"}
	return Config{
		Host: host, Port: portNumber, TLS: TLSNone,
		Username: username, Password: password,
		From:    mail.Address{Name: "Elitea", Address: "noreply@acme.example"},
		ReplyTo: &replyTo,
		Timeout: 5 * time.Second,
	}
}

func TestSend_OverARealSocketWithAuth(t *testing.T) {
	stub := newSMTPStub(t, true)
	transport, err := New(stubConfig(t, stub, "user", "secret"))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	err = transport.Send(context.Background(), Message{
		To:       mail.Address{Name: "Ada", Address: "ada@example.com"},
		Subject:  "Welcome to Acme AI — émoji ✓",
		Text:     "Hello Ada,\n.leading dot line\nbye",
		HTML:     "<p>Hello <b>Ada</b></p>",
		FromName: "Acme AI",
	})
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	stub.mu.Lock()
	defer stub.mu.Unlock()
	// net/smtp appends BODY=8BITMIME when the server advertises it.
	if !strings.HasPrefix(stub.from, "<noreply@acme.example>") || stub.to != "<ada@example.com>" {
		t.Fatalf("envelope: from %q to %q", stub.from, stub.to)
	}
	decoded, _ := base64.StdEncoding.DecodeString(stub.authLine)
	if string(decoded) != "\x00user\x00secret" {
		t.Fatalf("AUTH PLAIN payload = %q", decoded)
	}
	for _, want := range []string{
		`From: "Acme AI" <noreply@acme.example>`,
		`To: "Ada" <ada@example.com>`,
		`Reply-To: "Support" <support@acme.example>`,
		"Subject: =?utf-8?q?",
		"Content-Type: multipart/alternative; boundary=",
		"Content-Type: text/plain; charset=utf-8",
		"Content-Type: text/html; charset=utf-8",
		"<p>Hello <b>Ada</b></p>",
		"Auto-Submitted: auto-generated",
		".leading dot line", // dot-stuffing survived the round trip
	} {
		if !strings.Contains(stub.data, want) {
			t.Errorf("message lacks %q:\n%s", want, stub.data)
		}
	}
	// The text part precedes the HTML part.
	if strings.Index(stub.data, "text/plain") > strings.Index(stub.data, "text/html") {
		t.Errorf("text part must come first for clients that render the last part they can")
	}
}

func TestSend_RefusesCredentialsWithoutAUTH(t *testing.T) {
	stub := newSMTPStub(t, false)
	transport, err := New(stubConfig(t, stub, "user", "secret"))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	err = transport.Send(context.Background(), Message{To: mail.Address{Address: "a@b.example"}, Subject: "x", Text: "y"})
	if err == nil || !strings.Contains(err.Error(), "no AUTH") {
		t.Fatalf("expected an AUTH refusal, got %v", err)
	}
}

func TestSend_STARTTLSRequiredByDefault(t *testing.T) {
	stub := newSMTPStub(t, false)
	config := stubConfig(t, stub, "", "")
	config.TLS = "" // default
	transport, err := New(config)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	err = transport.Send(context.Background(), Message{To: mail.Address{Address: "a@b.example"}, Subject: "x", Text: "y"})
	if err == nil || !strings.Contains(err.Error(), "STARTTLS") {
		t.Fatalf("a server without STARTTLS must be refused in the default mode, got %v", err)
	}
}

func TestNew_Validation(t *testing.T) {
	base := Config{Host: "smtp.example", Port: 587, From: mail.Address{Address: "n@e.example"}}
	for name, mutate := range map[string]func(c *Config){
		"no host":      func(c *Config) { c.Host = " " },
		"bad port":     func(c *Config) { c.Port = 70000 },
		"no from":      func(c *Config) { c.From = mail.Address{} },
		"bad tls":      func(c *Config) { c.TLS = "ssl" },
		"user no pass": func(c *Config) { c.Username = "u" },
		"pass no user": func(c *Config) { c.Password = "p" },
	} {
		t.Run(name, func(t *testing.T) {
			config := base
			mutate(&config)
			if _, err := New(config); err == nil {
				t.Fatal("accepted")
			}
		})
	}
	if _, err := New(base); err != nil {
		t.Fatalf("valid config refused: %v", err)
	}
}

func TestEncode_TextOnly(t *testing.T) {
	out := string(Encode(mail.Address{Address: "n@e.example"}, nil,
		Message{To: mail.Address{Address: "a@b.example"}, Subject: "Plain", Text: "line1\nline2"}, time.Unix(0, 0)))
	if !strings.Contains(out, "Content-Type: text/plain; charset=utf-8\r\n") || strings.Contains(out, "multipart") {
		t.Fatalf("text-only encoding wrong:\n%s", out)
	}
	if !strings.HasSuffix(out, "line1\r\nline2") {
		t.Fatalf("line endings not normalised:\n%q", out)
	}
	if err := (NullTransport{}).Send(context.Background(), Message{}); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("NullTransport must answer ErrNotConfigured, got %v", err)
	}
}
