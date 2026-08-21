package llmproxy

import (
	"bufio"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// TestProxyCarriesAWebSocketUpgrade proves the edge can carry the gateway's
// realtime route (issue #323).
//
// The realtime ASR surface is a WebSocket, and it reaches the gateway through
// THIS proxy. Nothing else asserted that an upgrade survives it. Two properties
// of the proxy could each end that silently, and this test owns both:
//
//   - Rewrite runs stripIdentityHeaders on the outbound header. It must remove
//     the client's credentials and must NOT remove Connection or Upgrade. Both
//     halves are asserted below, because a strip that took the upgrade headers
//     with it would present as "the provider refused the handshake".
//   - FlushInterval: -1 must not interfere with the hijacked connection, so the
//     test writes and reads over the pipe after the 101.
//
// A THIRD property is load-bearing and is NOT tested here: httputil.ReverseProxy
// switches to a raw byte pipe only when the round-tripper returns a 101 whose
// Body is an io.ReadWriteCloser, and *http.Transport does that only over
// HTTP/1.1. This test injects its own transport, so it cannot see that setting.
// TestNewMTLSTransport in proxy_test.go owns it: it asserts
// ForceAttemptHTTP2 == false and NextProtos == ["http/1.1"]. Keep that test.
//
// The test speaks raw HTTP/1.1 rather than using a WebSocket library on purpose:
// the handshake and the byte pipe are the contract, not any framing.
func TestProxyCarriesAWebSocketUpgrade(t *testing.T) {
	var sawUpgrade, sawConnection, sawKey, sawAuth, sawProj string
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawUpgrade = r.Header.Get("Upgrade")
		sawConnection = r.Header.Get("Connection")
		sawKey = r.Header.Get("Sec-WebSocket-Key")
		sawAuth = r.Header.Get("Authorization")
		sawProj = r.Header.Get("X-Elitea-Project-Id")
		if !strings.EqualFold(sawUpgrade, "websocket") {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		hj, ok := w.(http.Hijacker)
		if !ok {
			t.Error("backend ResponseWriter is not a Hijacker")
			return
		}
		conn, buf, err := hj.Hijack()
		if err != nil {
			t.Errorf("backend hijack: %v", err)
			return
		}
		defer conn.Close()
		_, _ = buf.WriteString("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: probe\r\n\r\n")
		_ = buf.Flush()
		// Echo one line so we can prove the byte pipe is live in both directions.
		line, _ := buf.ReadString('\n')
		_, _ = buf.WriteString("ECHO:" + line)
		_ = buf.Flush()
	}))
	defer backend.Close()

	p, err := New(Config{TargetURL: backend.URL, Transport: backend.Client().Transport, IdentitySecret: "s3cr3t"})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	edge := httptest.NewServer(p)
	defer edge.Close()

	conn, err := net.DialTimeout("tcp", strings.TrimPrefix(edge.URL, "http://"), 3*time.Second)
	if err != nil {
		t.Fatalf("dial edge: %v", err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))

	req := "GET /llm/v1/realtime?model=m&intent=transcription HTTP/1.1\r\n" +
		"Host: edge\r\n" +
		"Upgrade: websocket\r\n" +
		"Connection: Upgrade\r\n" +
		"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
		"Sec-WebSocket-Version: 13\r\n" +
		"Authorization: Bearer client-token\r\n" +
		"\r\n"
	if _, err := conn.Write([]byte(req)); err != nil {
		t.Fatalf("write upgrade request: %v", err)
	}

	br := bufio.NewReader(conn)
	status, err := br.ReadString('\n')
	if err != nil {
		t.Fatalf("read status line: %v", err)
	}
	t.Logf("STATUS LINE: %q", strings.TrimSpace(status))
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			t.Fatalf("read header: %v", err)
		}
		if strings.TrimSpace(line) == "" {
			break
		}
		t.Logf("RESP HEADER: %q", strings.TrimSpace(line))
	}
	if !strings.Contains(status, "101") {
		t.Fatalf("edge did NOT switch protocols: %q", strings.TrimSpace(status))
	}

	if _, err := conn.Write([]byte("ping\n")); err != nil {
		t.Fatalf("write over upgraded conn: %v", err)
	}
	echo, err := br.ReadString('\n')
	if err != nil {
		t.Fatalf("read echo over upgraded conn: %v", err)
	}
	t.Logf("ECHO BACK: %q", strings.TrimSpace(echo))

	if echo != "ECHO:ping\n" {
		t.Fatalf("echo over the upgraded connection = %q, want %q", echo, "ECHO:ping\n")
	}

	// The handshake fields the backend needs must arrive intact.
	if !strings.EqualFold(sawUpgrade, "websocket") || !strings.EqualFold(sawConnection, "Upgrade") {
		t.Fatalf("backend saw Upgrade=%q Connection=%q; the proxy dropped the upgrade headers",
			sawUpgrade, sawConnection)
	}
	if sawKey != "dGhlIHNhbXBsZSBub25jZQ==" {
		t.Fatalf("backend saw Sec-WebSocket-Key=%q; the proxy dropped the handshake key", sawKey)
	}

	// And the client's own credential must NOT. stripIdentityHeaders owns this;
	// the gateway may only ever see the edge-signed identity.
	if sawAuth != "" {
		t.Fatalf("backend saw Authorization=%q; the client credential crossed the trust boundary", sawAuth)
	}
	_ = sawProj // populated from the request-scoped ProjectContext in production
}
