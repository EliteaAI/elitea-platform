package rpc

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/hmac"
	"crypto/sha512"
	"encoding/binary"
	"fmt"
	"math"

	"github.com/redis/go-redis/v9"
)

// Client publishes RPC calls to pylon services via Redis pub/sub,
// using the arbiter wire format: gzip(pickle({name, payload})) [+ HMAC].
type Client struct {
	rdb     *redis.Client
	channel string
	hmacKey []byte
}

// New creates an RPC Client.
func New(rdb *redis.Client, channel string, hmacKey string) *Client {
	var key []byte
	if hmacKey != "" {
		key = []byte(hmacKey)
	}
	return &Client{rdb: rdb, channel: channel, hmacKey: key}
}

// Call dispatches an RPC function call to pylon via Redis pub/sub.
// kwargs are passed as the payload dict. No reply is expected — but the call is
// NOT "fire and forget", and the difference is the whole point of the returned
// count.
//
// Redis PUBLISH answers with the number of clients the message was delivered to
// (https://redis.io/docs/latest/commands/publish/). With zero subscribers that
// is 0 and the command still succeeds, so `err == nil` says only that Redis
// accepted the bytes — never that anything will act on them. `elitea_rpc` is
// consumed by legacy Pylon and by nothing in this repository (issue #305), so
// on a Go-only stack every dispatch lands in an empty room and reports success.
//
// Returning the receiver count lets the caller tell "delivered to a consumer"
// from "delivered to nobody" instead of treating both as done. The count is a
// lower bound on what will actually run — a subscriber can still crash before
// handling the payload — but a ZERO is proof that nothing did.
func (c *Client) Call(ctx context.Context, funcName string, kwargs map[string]any) (int64, error) {
	data, err := c.encodeMessage(funcName, kwargs)
	if err != nil {
		return 0, fmt.Errorf("rpc: encode: %w", err)
	}
	receivers, err := c.rdb.Publish(ctx, c.channel, data).Result()
	if err != nil {
		return 0, err
	}
	return receivers, nil
}

// encodeMessage builds the arbiter wire format:
// gzip(pickle({"name": funcName, "payload": kwargs})) + optional HMAC-SHA512
func (c *Client) encodeMessage(funcName string, kwargs map[string]any) ([]byte, error) {
	pickled := pickleRPCEvent(funcName, kwargs)

	var buf bytes.Buffer
	gz, err := gzip.NewWriterLevel(&buf, gzip.DefaultCompression)
	if err != nil {
		return nil, err
	}
	if _, err := gz.Write(pickled); err != nil {
		return nil, err
	}
	if err := gz.Close(); err != nil {
		return nil, err
	}

	data := buf.Bytes()

	if c.hmacKey != nil {
		mac := hmac.New(sha512.New, c.hmacKey)
		mac.Write(data)
		data = append(data, mac.Sum(nil)...)
	}

	return data, nil
}

// pickleRPCEvent serializes {"name": funcName, "payload": kwargs} using Python pickle protocol 5.
// We emit a minimal pickle bytecode stream that CPython can unpickle into the expected dict.
func pickleRPCEvent(funcName string, kwargs map[string]any) []byte {
	var buf bytes.Buffer

	// Protocol 2 header (widely compatible)
	buf.WriteByte(0x80) // PROTO
	buf.WriteByte(0x02) // protocol 2

	// Empty dict
	buf.WriteByte('}') // EMPTY_DICT

	// Mark for SETITEMS
	buf.WriteByte('q') // BINPUT (memo 0)
	buf.WriteByte(0x00)

	// Push items using MARK + key + value pairs + SETITEMS
	buf.WriteByte('(') // MARK

	// "name" key
	writePickleString(&buf, "name")
	// funcName value
	writePickleString(&buf, funcName)

	// "payload" key
	writePickleString(&buf, "payload")
	// payload value (dict of kwargs or None)
	if len(kwargs) == 0 {
		buf.WriteByte('N') // NONE
	} else {
		writePickleDict(&buf, kwargs)
	}

	buf.WriteByte('u') // SETITEMS

	buf.WriteByte('.') // STOP

	return buf.Bytes()
}

func writePickleString(buf *bytes.Buffer, s string) {
	b := []byte(s)
	if len(b) < 256 {
		buf.WriteByte(0x8c) // SHORT_BINUNICODE
		buf.WriteByte(byte(len(b)))
		buf.Write(b)
	} else {
		buf.WriteByte(0x8d) // BINUNICODE8 — protocol 4+, fallback to BINUNICODE
		// Use BINUNICODE (opcode X) for longer strings
		buf.Reset() // shouldn't happen for our use case, but safe
		buf.WriteByte('X')
		l := uint32(len(b))
		_ = binary.Write(buf, binary.LittleEndian, l) // bytes.Buffer.Write never errors
		buf.Write(b)
	}
}

func writePickleDict(buf *bytes.Buffer, m map[string]any) {
	buf.WriteByte('}') // EMPTY_DICT
	if len(m) == 0 {
		return
	}
	buf.WriteByte('(') // MARK
	for k, v := range m {
		writePickleString(buf, k)
		writePickleValue(buf, v)
	}
	buf.WriteByte('u') // SETITEMS
}

func writePickleValue(buf *bytes.Buffer, v any) {
	switch val := v.(type) {
	case nil:
		buf.WriteByte('N') // NONE
	case bool:
		if val {
			buf.WriteByte(0x88) // NEWTRUE
		} else {
			buf.WriteByte(0x89) // NEWFALSE
		}
	case int:
		writePickleInt(buf, int64(val))
	case int64:
		writePickleInt(buf, val)
	case float64:
		buf.WriteByte('G') // BINFLOAT
		bits := math.Float64bits(val)
		_ = binary.Write(buf, binary.BigEndian, bits) // bytes.Buffer.Write never errors
	case string:
		writePickleString(buf, val)
	case map[string]any:
		writePickleDict(buf, val)
	default:
		// Fallback: encode as string representation
		writePickleString(buf, fmt.Sprintf("%v", val))
	}
}

func writePickleInt(buf *bytes.Buffer, n int64) {
	if n >= 0 && n < 256 {
		buf.WriteByte('K') // BININT1
		buf.WriteByte(byte(n))
	} else if n >= 0 && n < 65536 {
		buf.WriteByte('M') // BININT2
		_ = binary.Write(buf, binary.LittleEndian, uint16(n)) // bytes.Buffer.Write never errors
	} else {
		buf.WriteByte('J') // BININT
		_ = binary.Write(buf, binary.LittleEndian, int32(n)) // bytes.Buffer.Write never errors
	}
}
