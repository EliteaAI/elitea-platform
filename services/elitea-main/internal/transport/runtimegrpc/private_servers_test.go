package runtimegrpc

import (
	"net"
	"testing"
	"time"
)

func TestBoundedListenerDoesNotAcceptBeyondConnectionCapacity(t *testing.T) {
	underlying := newQueuedListener()
	listener := newBoundedListener(underlying, 1)
	defer func() { _ = listener.Close() }()

	firstServer, firstClient := net.Pipe()
	defer func() { _ = firstClient.Close() }()
	underlying.connections <- firstServer
	first, err := listener.Accept()
	if err != nil {
		t.Fatal(err)
	}

	secondServer, secondClient := net.Pipe()
	defer func() { _ = secondClient.Close() }()
	underlying.connections <- secondServer
	accepted := make(chan net.Conn, 1)
	go func() {
		connection, acceptErr := listener.Accept()
		if acceptErr == nil {
			accepted <- connection
		}
	}()
	select {
	case connection := <-accepted:
		_ = connection.Close()
		t.Fatal("second connection bypassed the configured capacity")
	case <-time.After(20 * time.Millisecond):
	}

	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case connection := <-accepted:
		if err := connection.Close(); err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("released capacity did not unblock the next connection")
	}
}

type queuedListener struct {
	connections chan net.Conn
	closed      chan struct{}
}

func newQueuedListener() *queuedListener {
	return &queuedListener{connections: make(chan net.Conn, 2), closed: make(chan struct{})}
}

func (l *queuedListener) Accept() (net.Conn, error) {
	select {
	case connection := <-l.connections:
		return connection, nil
	case <-l.closed:
		return nil, net.ErrClosed
	}
}

func (l *queuedListener) Close() error {
	select {
	case <-l.closed:
		return net.ErrClosed
	default:
		close(l.closed)
		return nil
	}
}

func (l *queuedListener) Addr() net.Addr { return testAddress("runtime-test") }

type testAddress string

func (a testAddress) Network() string { return string(a) }
func (a testAddress) String() string  { return string(a) }

var _ net.Listener = (*queuedListener)(nil)
