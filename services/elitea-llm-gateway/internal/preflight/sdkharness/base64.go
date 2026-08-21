package sdkharness

import (
	"encoding/base64"
	"encoding/binary"
	"math"
)

// base64Float32LE encodes a float32 vector the way an OpenAI-compatible
// provider does when encoding_format is base64: little-endian IEEE-754 binary32
// values, concatenated, then standard base64.
//
// The layout is not decoration. openai-python decodes the string with
// numpy.frombuffer(..., dtype="float32") (and a struct fallback), so a
// big-endian or float64 payload decodes into numbers of the wrong magnitude or
// the wrong count. Getting it wrong here fails a driver assertion, which is the
// intended behaviour: a wrong ELEMENT SIZE changes the width and fails the
// width assertion, while a wrong BYTE ORDER keeps the width and fails the
// monotonicity assertion instead. Both measure the decode, not the transport.
func base64Float32LE(values []float32) string {
	buf := make([]byte, 4*len(values))
	for i, v := range values {
		binary.LittleEndian.PutUint32(buf[4*i:], math.Float32bits(v))
	}
	return base64.StdEncoding.EncodeToString(buf)
}
