package tenant

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRegisteredSchemaName(t *testing.T) {
	t.Parallel()

	for _, valid := range []string{"p_1", "p_42", "p_999999"} {
		require.True(t, registeredSchemaName.MatchString(valid), valid)
	}
	for _, invalid := range []string{"", "p_0", "p_-1", "p_01", "public", "p_1, public", "p_1; DROP SCHEMA public"} {
		require.False(t, registeredSchemaName.MatchString(invalid), invalid)
	}
}
