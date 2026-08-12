package repos

import (
	"math"
	"testing"
)

func TestCurrentAgentDatabaseIDBoundsCurrentIntegerSchema(t *testing.T) {
	for _, test := range []struct {
		name  string
		value int64
		want  int32
		ok    bool
	}{
		{name: "minimum", value: 1, want: 1, ok: true},
		{name: "maximum", value: math.MaxInt32, want: math.MaxInt32, ok: true},
		{name: "zero", value: 0},
		{name: "negative", value: -1},
		{name: "overflow", value: math.MaxInt32 + 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, ok := currentAgentDatabaseID(test.value)
			if got != test.want || ok != test.ok {
				t.Fatalf("current agent database ID = (%d, %t), want (%d, %t)", got, ok, test.want, test.ok)
			}
		})
	}
}
