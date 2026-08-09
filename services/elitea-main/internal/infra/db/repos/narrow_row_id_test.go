package repos

import (
	"math"
	"testing"
)

// TestNarrowRowID pins the guard that stands between a domain int64 id and the
// int32 sqlc params (CodeQL go/incorrect-integer-conversion, alerts 74-78).
//
// It asserts the CONSEQUENCE rather than the range, because the range on its own
// reads like a lint: Go's int64->int32 conversion is a silent truncation, so an
// out-of-range id does not fail — it becomes a DIFFERENT, entirely valid row id.
// These values are then used to read and WRITE rows.
func TestNarrowRowID(t *testing.T) {
	t.Parallel()

	t.Run("an out-of-range id must not alias onto a valid row", func(t *testing.T) {
		t.Parallel()

		// A var, not a const: Go rejects an int32-overflowing constant at compile
		// time, so a const could not demonstrate the runtime truncation at all.
		aliasing := int64(math.MaxUint32) + 5
		if int32(aliasing) != 4 {
			t.Fatalf("premise broken: int32(%d) = %d, want 4 — this test no longer "+
				"demonstrates truncation aliasing and must be rewritten", aliasing, int32(aliasing))
		}
		if got, ok := narrowRowID(aliasing); ok {
			t.Fatalf("narrowRowID(%d) accepted and returned %d; it truncates to %d, so "+
				"accepting it would address row %d", aliasing, got, int32(aliasing), int32(aliasing))
		}
	})

	t.Run("boundary", func(t *testing.T) {
		t.Parallel()

		cases := []struct {
			name  string
			value int64
			want  bool
		}{
			{"zero is allowed (not all ids are 1-based here)", 0, true},
			{"one", 1, true},
			{"max int32 fits the column", math.MaxInt32, true},
			{"one past max int32 does not", int64(math.MaxInt32) + 1, false},
			{"max int64 does not", math.MaxInt64, false},
			{"negative is not a row id", -1, false},
			{"min int64 is not a row id", math.MinInt64, false},
		}

		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				t.Parallel()
				got, ok := narrowRowID(tc.value)
				if ok != tc.want {
					t.Fatalf("narrowRowID(%d) ok = %v, want %v", tc.value, ok, tc.want)
				}
				if ok && int64(got) != tc.value {
					t.Fatalf("narrowRowID(%d) = %d; an accepted value must round-trip exactly",
						tc.value, got)
				}
			})
		}
	})
}
