package migrate

import (
	"crypto/subtle"
	"fmt"
)

func verifyChecksum(migration Migration, recorded []byte) error {
	if len(recorded) != len(migration.Checksum) ||
		subtle.ConstantTimeCompare(recorded, migration.Checksum[:]) != 1 {
		return fmt.Errorf("migrate: checksum mismatch for %s", migration.Path)
	}
	return nil
}
