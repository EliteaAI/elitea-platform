package indexschedule

import (
	"errors"
	"math"
	"strings"
	"time"
)

const MaxScheduleFailureEffectIDBytes = 200

var ErrInvalidScheduleFailure = errors.New("invalid index schedule failure")

type FailureEffect struct {
	EffectID    string
	ProjectID   int64
	UserID      int64
	ToolkitID   int64
	IndexMetaID string
	SafeReason  string
	OccurredAt  time.Time
}

func (effect FailureEffect) Validate() error {
	if effect.EffectID == "" ||
		len(effect.EffectID) > MaxScheduleFailureEffectIDBytes ||
		strings.ContainsAny(effect.EffectID, "\x00\r\n") ||
		effect.ProjectID <= 0 || effect.ProjectID > math.MaxInt32 ||
		effect.UserID <= 0 || effect.UserID > math.MaxInt32 ||
		effect.ToolkitID <= 0 || effect.ToolkitID > math.MaxInt32 ||
		!validIndexMetaID(effect.IndexMetaID) ||
		!validSafeReason(effect.SafeReason) ||
		effect.OccurredAt.IsZero() {
		return ErrInvalidScheduleFailure
	}
	return nil
}
