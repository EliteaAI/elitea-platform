package agentexecution

import (
	"math"
	"strconv"
	"testing"
)

// TestPositiveCanonicalID_RejectsIDsThatCannotAddressARow pins the upper bound
// on parsed ids.
//
// CodeQL flagged five int32() narrowings downstream of this function
// (go/incorrect-integer-conversion, alerts 74-78). The rule's name undersells
// the consequence, which is why this test asserts the CONSEQUENCE rather than
// the range: the underlying columns are Postgres `integer`, sqlc types them
// int32, and Go's int64->int32 conversion is a silent truncation. So without
// the bound, `math.MaxUint32 + 5` does not fail — it becomes `5`, and the
// caller reaches a different, entirely valid row.
//
// That is an aliasing bug with an authorization flavour, not a lossy-conversion
// nit: two distinct ids denote the same entity, and the one the caller sent is
// not the one the database sees.
func TestPositiveCanonicalID_RejectsIDsThatCannotAddressARow(t *testing.T) {
	t.Parallel()

	t.Run("an out-of-range id must not alias onto a valid row", func(t *testing.T) {
		t.Parallel()

		// 4294967300 == math.MaxUint32 + 5. int32 of it == 4.
		// Deliberately a var, not a const: Go rejects a constant that overflows
		// int32 at compile time, so a const here would not compile and could not
		// demonstrate the runtime truncation this test exists to pin.
		aliasing := int64(math.MaxUint32) + 5
		if int32(aliasing) != 4 {
			t.Fatalf("premise broken: int32(%d) = %d, want 4 — this test no longer "+
				"demonstrates truncation aliasing and must be rewritten", aliasing, int32(aliasing))
		}

		got, ok := positiveCanonicalID(strconv.FormatInt(aliasing, 10))
		if ok {
			t.Fatalf("positiveCanonicalID(%d) was accepted (parsed %d); it truncates to %d, "+
				"so accepting it lets a caller address row 4 by sending %d",
				aliasing, got, int32(aliasing), aliasing)
		}
	})

	t.Run("boundary", func(t *testing.T) {
		t.Parallel()

		cases := []struct {
			name string
			raw  string
			want bool
		}{
			{"max int32 is addressable", strconv.Itoa(math.MaxInt32), true},
			{"one past max int32 is not", strconv.FormatInt(int64(math.MaxInt32)+1, 10), false},
			{"max int64 is not", strconv.FormatInt(math.MaxInt64, 10), false},
			{"one is addressable", "1", true},
			{"zero is not an id", "0", false},
			{"negative is not an id", "-1", false},
			// Canonical-spelling guard, pre-existing behaviour: two different
			// strings must never denote the same entity.
			{"leading zeros rejected", "007", false},
			{"explicit plus rejected", "+5", false},
			{"not a number", "abc", false},
			{"empty", "", false},
		}

		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				t.Parallel()
				if _, ok := positiveCanonicalID(tc.raw); ok != tc.want {
					t.Fatalf("positiveCanonicalID(%q) = %v, want %v", tc.raw, ok, tc.want)
				}
			})
		}
	})
}
