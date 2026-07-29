package runtime

import (
	"bytes"
	"crypto/ed25519"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"testing"
)

func TestEd25519WorkerCommandSigningInputIsDomainSeparatedAndLengthBound(t *testing.T) {
	command := []byte{0x08, 0x01, 0x12, 0x02, 0x61, 0x62}
	input, err := Ed25519WorkerCommandSigningInput(command)
	if err != nil {
		t.Fatal(err)
	}
	prefix := []byte(ed25519WorkerCommandDomain)
	if !bytes.HasPrefix(input, prefix) {
		t.Fatal("signature input is missing its protocol domain")
	}
	if got := binary.BigEndian.Uint64(input[len(prefix) : len(prefix)+8]); got != uint64(len(command)) {
		t.Fatalf("signature input length = %d, want %d", got, len(command))
	}
	if !bytes.Equal(input[len(prefix)+8:], command) {
		t.Fatal("signature input did not preserve the exact command bytes")
	}
	command[0] ^= 0xff
	if bytes.Equal(input[len(prefix)+8:], command) {
		t.Fatal("signature input aliases caller-owned command bytes")
	}
}

func TestEd25519WorkerCommandSigningInputRejectsEmptyCommand(t *testing.T) {
	if _, err := Ed25519WorkerCommandSigningInput(nil); !errors.Is(err, ErrInvalidWorkerCommandSignatureInput) {
		t.Fatalf("error = %v, want %v", err, ErrInvalidWorkerCommandSignatureInput)
	}
}

func TestEd25519WorkerCommandSigningInputCrossLanguageVector(t *testing.T) {
	seed := make([]byte, ed25519.SeedSize)
	for index := range seed {
		seed[index] = byte(index)
	}
	privateKey := ed25519.NewKeyFromSeed(seed)
	command := []byte("elitea-production-signature-vector-v1")
	input, err := Ed25519WorkerCommandSigningInput(command)
	if err != nil {
		t.Fatal(err)
	}
	wantPublic := "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8"
	wantSignature := "787b39572ae42d7770697c968300cb772af1844d2a56b354cf580d523c8b2682da70be4e4e21f951f390f9c8f3d961ab79159c1a7d85effa4935ebd765eb0900"
	if got := hex.EncodeToString(privateKey.Public().(ed25519.PublicKey)); got != wantPublic {
		t.Fatalf("public key = %s, want %s", got, wantPublic)
	}
	if got := hex.EncodeToString(ed25519.Sign(privateKey, input)); got != wantSignature {
		t.Fatalf("signature = %s, want %s", got, wantSignature)
	}
}
