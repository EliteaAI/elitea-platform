package secrets

import (
	"bytes"
	"crypto/aes"
	"testing"
)

// TestPKCS7Pad_RejectsUnrepresentableBlockSizes covers the two guards added for
// CodeQL go/allocation-size-overflow (alert 11) — and the second guard matters
// more than the alert that prompted it.
//
// PKCS#7 encodes the pad length in ONE byte, so a block size above 255 cannot be
// represented. Before this change `byte(pad)` truncated silently: pad 256 became
// 0, producing a token that either fails to unpad or unpads to the wrong length.
// For a SECRET value, silent corruption is materially worse than a rejected
// call, and nothing in the old signature could report it.
func TestPKCS7Pad_RejectsUnrepresentableBlockSizes(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name      string
		blockSize int
		wantErr   bool
	}{
		{"aes block size is fine", aes.BlockSize, false},
		{"one is fine", 1, false},
		{"255 is the largest representable pad", 255, false},
		{"256 cannot be encoded in the pad byte", 256, true},
		{"zero is not a block size", 0, true},
		{"negative is not a block size", -16, true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got, err := pkcs7Pad([]byte("secret-value"), tc.blockSize)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("pkcs7Pad(blockSize=%d) succeeded, want error; "+
						"a pad length above 255 truncates to byte(%d)=%d and corrupts the value",
						tc.blockSize, tc.blockSize, byte(tc.blockSize))
				}
				return
			}
			if err != nil {
				t.Fatalf("pkcs7Pad(blockSize=%d) = %v, want success", tc.blockSize, err)
			}
			if len(got)%tc.blockSize != 0 {
				t.Fatalf("padded length %d is not a multiple of block size %d", len(got), tc.blockSize)
			}
		})
	}
}

// TestPKCS7_RoundTrip is the guard against "fixed the alert, broke the crypto".
// A padding change that still satisfies the bounds checks but mis-pads would be
// invisible to the test above, and would corrupt every stored secret.
func TestPKCS7_RoundTrip(t *testing.T) {
	t.Parallel()

	inputs := [][]byte{
		{},
		[]byte("a"),
		[]byte("exactly-16-bytes"),  // len == block size: PKCS#7 must add a FULL block
		[]byte("seventeen bytes.."), // one past a block
		bytes.Repeat([]byte("x"), aes.BlockSize*4), // exact multiple
		bytes.Repeat([]byte("y"), aes.BlockSize*4-1),
	}

	for _, in := range inputs {
		padded, err := pkcs7Pad(in, aes.BlockSize)
		if err != nil {
			t.Fatalf("pad(%d bytes): %v", len(in), err)
		}
		if len(padded)%aes.BlockSize != 0 {
			t.Fatalf("padded length %d is not a multiple of %d", len(padded), aes.BlockSize)
		}
		// PKCS#7 always adds at least one byte — a full block when the input is
		// already aligned — so that unpadding is unambiguous.
		if len(padded) <= len(in) {
			t.Fatalf("pad(%d bytes) produced %d bytes; padding must always grow the input",
				len(in), len(padded))
		}
		out, err := pkcs7Unpad(padded)
		if err != nil {
			t.Fatalf("unpad after pad(%d bytes): %v", len(in), err)
		}
		if !bytes.Equal(out, in) {
			t.Fatalf("round trip changed the value: got %q, want %q", out, in)
		}
	}
}
