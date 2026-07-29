package runtime

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

const digestPrefix = "sha256:"

var ErrInvalidDigest = errors.New("invalid SHA-256 digest")

// Digest is an exact SHA-256 value. Its fixed-size representation prevents a
// partially populated digest from crossing an application boundary.
type Digest [sha256.Size]byte

func SHA256(content []byte) Digest {
	return sha256.Sum256(content)
}

func ParseDigest(value string) (Digest, error) {
	var digest Digest
	if !strings.HasPrefix(value, digestPrefix) {
		return digest, ErrInvalidDigest
	}

	raw := strings.TrimPrefix(value, digestPrefix)
	if len(raw) != hex.EncodedLen(len(digest)) || raw != strings.ToLower(raw) {
		return digest, ErrInvalidDigest
	}
	decoded, err := hex.DecodeString(raw)
	if err != nil {
		return digest, fmt.Errorf("%w: %v", ErrInvalidDigest, err)
	}
	copy(digest[:], decoded)
	return digest, nil
}

func (d Digest) String() string {
	return digestPrefix + hex.EncodeToString(d[:])
}

func (d Digest) IsZero() bool {
	return d == Digest{}
}
