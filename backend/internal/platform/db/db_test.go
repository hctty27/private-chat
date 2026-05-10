package db

import (
	"context"
	"errors"
	"net"
	"strings"
	"testing"
)

type bucketCheckerFunc func(context.Context, string) (bool, error)

func (f bucketCheckerFunc) BucketExists(ctx context.Context, bucket string) (bool, error) {
	return f(ctx, bucket)
}

func TestEnsureBucketExistsReturnsErrorWhenBucketMissing(t *testing.T) {
	err := ensureBucketExists(context.Background(), bucketCheckerFunc(func(context.Context, string) (bool, error) {
		return false, nil
	}), "private-chat-r2")
	if err == nil {
		t.Fatal("expected missing bucket error")
	}
	if !strings.Contains(err.Error(), "object storage bucket private-chat-r2 does not exist") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestEnsureBucketExistsWrapsCheckError(t *testing.T) {
	err := ensureBucketExists(context.Background(), bucketCheckerFunc(func(context.Context, string) (bool, error) {
		return false, errors.New("denied")
	}), "private-chat-r2")
	if err == nil {
		t.Fatal("expected check error")
	}
	if !strings.Contains(err.Error(), "object storage bucket check failed") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestPostgresLookupFuncReturnsOnlyIPv4Addresses(t *testing.T) {
	addrs, err := postgresLookupFunc(context.Background(), "localhost")
	if err != nil {
		t.Fatalf("lookup: %v", err)
	}
	if len(addrs) == 0 {
		t.Fatal("expected at least one IPv4 address")
	}
	for _, addr := range addrs {
		if ip := net.ParseIP(addr); ip == nil || ip.To4() == nil {
			t.Fatalf("expected only IPv4 addresses, got %q from %v", addr, addrs)
		}
	}
}

func TestPostgresDialFuncUsesIPv4(t *testing.T) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()

	accepted := make(chan net.Conn, 1)
	go func() {
		conn, err := listener.Accept()
		if err == nil {
			accepted <- conn
		}
	}()

	conn, err := postgresDialFunc(context.Background(), "tcp6", listener.Addr().String())
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer conn.Close()

	serverConn := <-accepted
	defer serverConn.Close()

	if conn.RemoteAddr().(*net.TCPAddr).IP.To4() == nil {
		t.Fatalf("expected IPv4 connection, got %s", conn.RemoteAddr())
	}
}
