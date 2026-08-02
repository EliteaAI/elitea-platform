package system_test

import (
	"bufio"
	"bytes"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const (
	redisFaultProxyMaxFrameBytes    = 1 << 20
	redisFaultProxyMaxBulkBytes     = 512 << 10
	redisFaultProxyMaxArrayElements = 1024
	redisFaultProxyMaxDepth         = 8
	redisFaultProxyLineBufferBytes  = 64 << 10
)

var (
	errRedisFaultProxyFrameTooLarge = errors.New("redis fault-proxy RESP frame exceeds its test bound")
	errRedisFaultProxyMalformed     = errors.New("redis fault-proxy RESP frame is malformed")
)

// redisRetirementResponseDropProxy is a harness-only TLS/RESP2 fault injector.
//
// Once armed, it forwards the first successful atomic retirement EVAL to Redis,
// reads Redis's complete {1, 1, 1} response, and closes the worker connection
// without forwarding that response. This places the fault after the durable
// XACK + XDEL + HDEL effect and before the caller can observe success.
type redisRetirementResponseDropProxy struct {
	listener       net.Listener
	backendAddress string
	backendTLS     *tls.Config

	armed   atomic.Bool
	dropped atomic.Bool
	closed  atomic.Bool
	dropCh  chan struct{}

	mu          sync.Mutex
	connections map[net.Conn]struct{}
	closeOnce   sync.Once
	wait        sync.WaitGroup
}

func startRedisRetirementResponseDropProxy(
	t *testing.T,
	pki runtimePKI,
	backendAddress string,
) *redisRetirementResponseDropProxy {
	t.Helper()

	serverCertificate, err := tls.LoadX509KeyPair(pki.redisCertPath, pki.redisKeyPath)
	if err != nil {
		t.Fatalf("load Redis fault-proxy server certificate: %v", err)
	}
	caPEM, err := os.ReadFile(pki.caPath)
	if err != nil {
		t.Fatalf("read Redis fault-proxy CA: %v", err)
	}
	caPool := x509.NewCertPool()
	if !caPool.AppendCertsFromPEM(caPEM) {
		t.Fatal("parse Redis fault-proxy CA")
	}
	workerCertificate, err := tls.LoadX509KeyPair(pki.workerCertPath, pki.workerKeyPath)
	if err != nil {
		t.Fatalf("load Redis fault-proxy backend certificate: %v", err)
	}

	rawListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen for Redis fault proxy: %v", err)
	}
	listener := tls.NewListener(rawListener, &tls.Config{
		MinVersion:   tls.VersionTLS13,
		Certificates: []tls.Certificate{serverCertificate},
	})
	proxy := &redisRetirementResponseDropProxy{
		listener:       listener,
		backendAddress: backendAddress,
		backendTLS: &tls.Config{
			MinVersion:   tls.VersionTLS13,
			RootCAs:      caPool,
			ServerName:   "localhost",
			Certificates: []tls.Certificate{workerCertificate},
		},
		dropCh:      make(chan struct{}),
		connections: make(map[net.Conn]struct{}),
	}
	proxy.wait.Add(1)
	go proxy.accept()
	t.Cleanup(proxy.Close)
	return proxy
}

func (p *redisRetirementResponseDropProxy) Port() int {
	return p.listener.Addr().(*net.TCPAddr).Port
}

func (p *redisRetirementResponseDropProxy) Arm() {
	if p.dropped.Load() {
		panic("Redis retirement-response fault is one-shot and already fired")
	}
	p.armed.Store(true)
}

func (p *redisRetirementResponseDropProxy) Dropped() <-chan struct{} {
	return p.dropCh
}

func (p *redisRetirementResponseDropProxy) Close() {
	p.closeOnce.Do(func() {
		p.closed.Store(true)
		_ = p.listener.Close()
		p.mu.Lock()
		connections := make([]net.Conn, 0, len(p.connections))
		for connection := range p.connections {
			connections = append(connections, connection)
		}
		p.mu.Unlock()
		for _, connection := range connections {
			_ = connection.Close()
		}
		p.wait.Wait()
	})
}

func (p *redisRetirementResponseDropProxy) accept() {
	defer p.wait.Done()
	for {
		connection, err := p.listener.Accept()
		if err != nil {
			return
		}
		if !p.track(connection) {
			_ = connection.Close()
			continue
		}
		p.wait.Add(1)
		go p.serve(connection)
	}
}

func (p *redisRetirementResponseDropProxy) serve(workerConnection net.Conn) {
	defer p.wait.Done()
	defer p.untrackAndClose(workerConnection)

	dialer := &net.Dialer{Timeout: 5 * time.Second}
	redisConnection, err := tls.DialWithDialer(
		dialer,
		"tcp",
		p.backendAddress,
		p.backendTLS.Clone(),
	)
	if err != nil {
		return
	}
	if !p.track(redisConnection) {
		_ = redisConnection.Close()
		return
	}
	defer p.untrackAndClose(redisConnection)

	workerStream := newRedisFaultProxyRESPStream(workerConnection)
	redisStream := newRedisFaultProxyRESPStream(redisConnection)
	for {
		request, err := workerStream.readFrame()
		if err != nil {
			return
		}
		if _, err := redisConnection.Write(request.raw); err != nil {
			return
		}
		response, err := redisStream.readFrame()
		if err != nil {
			return
		}
		if p.shouldDrop(request, response) {
			close(p.dropCh)
			return
		}
		if _, err := workerConnection.Write(response.raw); err != nil {
			return
		}
	}
}

func (p *redisRetirementResponseDropProxy) shouldDrop(request, response redisFaultProxyRESPFrame) bool {
	if !p.armed.Load() ||
		!isRedisRetirementEVAL(request) ||
		!isCommittedRedisRetirementResponse(response) {
		return false
	}
	if !p.dropped.CompareAndSwap(false, true) {
		return false
	}
	p.armed.Store(false)
	return true
}

func (p *redisRetirementResponseDropProxy) track(connection net.Conn) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.closed.Load() {
		return false
	}
	p.connections[connection] = struct{}{}
	return true
}

func (p *redisRetirementResponseDropProxy) untrackAndClose(connection net.Conn) {
	p.mu.Lock()
	delete(p.connections, connection)
	p.mu.Unlock()
	_ = connection.Close()
}

type redisFaultProxyRESPFrame struct {
	raw      []byte
	elements []redisFaultProxyRESPValue
}

type redisFaultProxyRESPValue struct {
	scalar   []byte
	elements []redisFaultProxyRESPValue
}

type redisFaultProxyRESPStream struct {
	reader *bufio.Reader
}

func newRedisFaultProxyRESPStream(reader io.Reader) *redisFaultProxyRESPStream {
	return &redisFaultProxyRESPStream{
		reader: bufio.NewReaderSize(reader, redisFaultProxyLineBufferBytes),
	}
}

func (s *redisFaultProxyRESPStream) readFrame() (redisFaultProxyRESPFrame, error) {
	parser := redisFaultProxyRESPParser{reader: s.reader}
	value, raw, err := parser.readValue(0)
	if err != nil {
		return redisFaultProxyRESPFrame{}, err
	}
	return redisFaultProxyRESPFrame{
		raw:      raw,
		elements: value.elements,
	}, nil
}

type redisFaultProxyRESPParser struct {
	reader    *bufio.Reader
	readBytes int
}

func (p *redisFaultProxyRESPParser) readValue(depth int) (redisFaultProxyRESPValue, []byte, error) {
	if depth > redisFaultProxyMaxDepth {
		return redisFaultProxyRESPValue{}, nil, errRedisFaultProxyMalformed
	}
	line, err := p.readLine()
	if err != nil {
		return redisFaultProxyRESPValue{}, nil, err
	}
	if len(line) < 3 {
		return redisFaultProxyRESPValue{}, nil, errRedisFaultProxyMalformed
	}

	switch line[0] {
	case '+', '-', ':':
		return redisFaultProxyRESPValue{
			scalar: append([]byte(nil), line[1:len(line)-2]...),
		}, line, nil
	case '$':
		length, err := parseRedisFaultProxyRESPCount(line)
		if err != nil {
			return redisFaultProxyRESPValue{}, nil, err
		}
		if length == -1 {
			return redisFaultProxyRESPValue{}, line, nil
		}
		if length < 0 || length > redisFaultProxyMaxBulkBytes {
			return redisFaultProxyRESPValue{}, nil, errRedisFaultProxyFrameTooLarge
		}
		if err := p.reserve(length + 2); err != nil {
			return redisFaultProxyRESPValue{}, nil, err
		}
		body := make([]byte, length+2)
		if _, err := io.ReadFull(p.reader, body); err != nil {
			return redisFaultProxyRESPValue{}, nil, err
		}
		if !bytes.HasSuffix(body, []byte("\r\n")) {
			return redisFaultProxyRESPValue{}, nil, errRedisFaultProxyMalformed
		}
		raw := make([]byte, 0, len(line)+len(body))
		raw = append(raw, line...)
		raw = append(raw, body...)
		return redisFaultProxyRESPValue{
			scalar: append([]byte(nil), body[:length]...),
		}, raw, nil
	case '*':
		count, err := parseRedisFaultProxyRESPCount(line)
		if err != nil {
			return redisFaultProxyRESPValue{}, nil, err
		}
		if count == -1 {
			return redisFaultProxyRESPValue{}, line, nil
		}
		if count < 0 || count > redisFaultProxyMaxArrayElements {
			return redisFaultProxyRESPValue{}, nil, errRedisFaultProxyFrameTooLarge
		}
		value := redisFaultProxyRESPValue{
			elements: make([]redisFaultProxyRESPValue, 0, count),
		}
		raw := append([]byte(nil), line...)
		for index := 0; index < count; index++ {
			element, elementRaw, err := p.readValue(depth + 1)
			if err != nil {
				return redisFaultProxyRESPValue{}, nil, err
			}
			value.elements = append(value.elements, element)
			raw = append(raw, elementRaw...)
		}
		return value, raw, nil
	default:
		return redisFaultProxyRESPValue{}, nil, errRedisFaultProxyMalformed
	}
}

func (p *redisFaultProxyRESPParser) readLine() ([]byte, error) {
	line, err := p.reader.ReadSlice('\n')
	if errors.Is(err, bufio.ErrBufferFull) {
		return nil, errRedisFaultProxyFrameTooLarge
	}
	if err != nil {
		return nil, err
	}
	if len(line) < 2 || line[len(line)-2] != '\r' {
		return nil, errRedisFaultProxyMalformed
	}
	if err := p.reserve(len(line)); err != nil {
		return nil, err
	}
	return append([]byte(nil), line...), nil
}

func (p *redisFaultProxyRESPParser) reserve(size int) error {
	if size < 0 || p.readBytes > redisFaultProxyMaxFrameBytes-size {
		return errRedisFaultProxyFrameTooLarge
	}
	p.readBytes += size
	return nil
}

func parseRedisFaultProxyRESPCount(line []byte) (int, error) {
	value, err := strconv.ParseInt(string(line[1:len(line)-2]), 10, 32)
	if err != nil {
		return 0, errRedisFaultProxyMalformed
	}
	return int(value), nil
}

func isRedisRetirementEVAL(frame redisFaultProxyRESPFrame) bool {
	if len(frame.elements) < 2 ||
		!strings.EqualFold(string(frame.elements[0].scalar), "EVAL") {
		return false
	}
	script := frame.elements[1].scalar
	return bytes.Contains(script, []byte("XACK")) &&
		bytes.Contains(script, []byte("XDEL")) &&
		bytes.Contains(script, []byte("HDEL"))
}

func isCommittedRedisRetirementResponse(frame redisFaultProxyRESPFrame) bool {
	if len(frame.elements) != 3 {
		return false
	}
	for _, element := range frame.elements {
		if !bytes.Equal(element.scalar, []byte("1")) {
			return false
		}
	}
	return true
}

func TestRedisFaultProxyRESPParserPreservesFramesAndPipelining(t *testing.T) {
	script := "return {redis.call('XACK'), redis.call('XDEL'), redis.call('HDEL')}\r\nbinary"
	request := redisFaultProxyRESPArray("EVAL", script, "2", "commands", "delivery-index")
	response := "*3\r\n:1\r\n:1\r\n:1\r\n"
	stream := newRedisFaultProxyRESPStream(strings.NewReader(request + response))

	parsedRequest, err := stream.readFrame()
	if err != nil {
		t.Fatal(err)
	}
	if string(parsedRequest.raw) != request {
		t.Fatal("request raw bytes changed while parsing")
	}
	if !isRedisRetirementEVAL(parsedRequest) {
		t.Fatal("retirement EVAL was not detected")
	}

	parsedResponse, err := stream.readFrame()
	if err != nil {
		t.Fatal(err)
	}
	if string(parsedResponse.raw) != response {
		t.Fatal("pipelined response raw bytes changed while parsing")
	}
	if !isCommittedRedisRetirementResponse(parsedResponse) {
		t.Fatal("successful retirement response was not recognized")
	}
}

func TestRedisFaultProxyRetirementDetectionRejectsOtherTraffic(t *testing.T) {
	tests := []struct {
		name    string
		request string
		want    bool
	}{
		{
			name:    "exact retirement EVAL",
			request: redisFaultProxyRESPArray("EVAL", "XACK XDEL HDEL", "2"),
			want:    true,
		},
		{
			name:    "heartbeat EVAL",
			request: redisFaultProxyRESPArray("EVAL", "XPENDING XCLAIM", "1"),
		},
		{
			name:    "cached script is not the requested injection boundary",
			request: redisFaultProxyRESPArray("EVALSHA", "XACK XDEL HDEL", "2"),
		},
		{
			name:    "ordinary command",
			request: redisFaultProxyRESPArray("PING"),
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			frame, err := newRedisFaultProxyRESPStream(strings.NewReader(test.request)).readFrame()
			if err != nil {
				t.Fatal(err)
			}
			if got := isRedisRetirementEVAL(frame); got != test.want {
				t.Fatalf("retirement detection=%t want=%t", got, test.want)
			}
		})
	}
}

func TestRedisFaultProxyDropDecisionIsOneShotAndRequiresCommittedResponse(t *testing.T) {
	request, err := newRedisFaultProxyRESPStream(
		strings.NewReader(redisFaultProxyRESPArray("EVAL", "XACK XDEL HDEL", "2")),
	).readFrame()
	if err != nil {
		t.Fatal(err)
	}
	committed, err := newRedisFaultProxyRESPStream(
		strings.NewReader("*3\r\n:1\r\n:1\r\n:1\r\n"),
	).readFrame()
	if err != nil {
		t.Fatal(err)
	}
	rejected, err := newRedisFaultProxyRESPStream(
		strings.NewReader("*3\r\n:0\r\n:0\r\n:0\r\n"),
	).readFrame()
	if err != nil {
		t.Fatal(err)
	}

	proxy := &redisRetirementResponseDropProxy{dropCh: make(chan struct{})}
	proxy.Arm()
	if proxy.shouldDrop(request, rejected) {
		t.Fatal("proxy dropped an uncommitted retirement response")
	}
	if !proxy.shouldDrop(request, committed) {
		t.Fatal("proxy did not drop the first committed retirement response")
	}
	if proxy.shouldDrop(request, committed) {
		t.Fatal("proxy dropped more than one retirement response")
	}
}

func TestRedisFaultProxyRESPParserEnforcesBounds(t *testing.T) {
	tests := []struct {
		name  string
		frame string
	}{
		{
			name:  "bulk limit",
			frame: fmt.Sprintf("$%d\r\n", redisFaultProxyMaxBulkBytes+1),
		},
		{
			name:  "array limit",
			frame: fmt.Sprintf("*%d\r\n", redisFaultProxyMaxArrayElements+1),
		},
		{
			name:  "depth limit",
			frame: strings.Repeat("*1\r\n", redisFaultProxyMaxDepth+2) + "$1\r\nx\r\n",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := newRedisFaultProxyRESPStream(strings.NewReader(test.frame)).readFrame()
			if err == nil {
				t.Fatal("unbounded RESP frame was accepted")
			}
			if !errors.Is(err, errRedisFaultProxyFrameTooLarge) &&
				!errors.Is(err, errRedisFaultProxyMalformed) {
				t.Fatalf("unexpected bound error: %v", err)
			}
		})
	}
}

func redisFaultProxyRESPArray(values ...string) string {
	var encoded strings.Builder
	fmt.Fprintf(&encoded, "*%d\r\n", len(values))
	for _, value := range values {
		fmt.Fprintf(&encoded, "$%d\r\n%s\r\n", len(value), value)
	}
	return encoded.String()
}
