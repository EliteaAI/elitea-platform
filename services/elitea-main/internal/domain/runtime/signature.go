package runtime

import (
	"encoding/binary"
	"errors"
)

const ed25519WorkerCommandDomain = "elitea.runtime.worker-command.ed25519.v1\x00"

var ErrInvalidWorkerCommandSignatureInput = errors.New("invalid worker command signature input")

// Ed25519WorkerCommandSigningInput returns the protocol-v1 production
// signature input. The fixed domain prevents a valid worker-command signature
// from authorizing bytes in another protocol, while the explicit length keeps
// the framing unambiguous. Callers sign the returned bytes with pure Ed25519
// (RFC 8032), never Ed25519ph and never the public conformance HMAC profile.
func Ed25519WorkerCommandSigningInput(exactCommandBytes []byte) ([]byte, error) {
	if len(exactCommandBytes) == 0 {
		return nil, ErrInvalidWorkerCommandSignatureInput
	}
	input := make([]byte, len(ed25519WorkerCommandDomain)+8+len(exactCommandBytes))
	offset := copy(input, ed25519WorkerCommandDomain)
	binary.BigEndian.PutUint64(input[offset:offset+8], uint64(len(exactCommandBytes)))
	copy(input[offset+8:], exactCommandBytes)
	return input, nil
}
