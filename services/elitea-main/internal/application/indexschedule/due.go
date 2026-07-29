package indexschedule

import (
	"errors"
	"strings"
	"time"
)

var (
	ErrInvalidStoredSchedule = errors.New("stored index schedule is invalid")
	ErrScheduleDependency    = errors.New("index schedule dependency failed")
	ErrScheduleAlreadyRun    = errors.New("index schedule runner is already running")
)

// DueOccurrence returns the exact cron occurrence that is due at now. The
// occurrence, rather than the scan time, is the stable identity used by
// scheduled admission retries.
func DueOccurrence(schedule Schedule, now time.Time) (time.Time, bool, error) {
	if schedule.CreatedBy <= 0 ||
		strings.TrimSpace(schedule.Cron) == "" ||
		len(schedule.Cron) > MaxCronBytes ||
		strings.ContainsAny(schedule.Cron, "\x00\r\n") {
		return time.Time{}, false, ErrInvalidStoredSchedule
	}
	if !schedule.Enabled {
		return time.Time{}, false, nil
	}
	if err := ValidateTimezone(schedule.Timezone); err != nil {
		return time.Time{}, false, ErrInvalidStoredSchedule
	}
	lastRun, err := parseStoredLastRun(schedule.LastRun)
	if err != nil {
		return time.Time{}, false, err
	}
	location, err := time.LoadLocation(schedule.Timezone)
	if err != nil {
		return time.Time{}, false, ErrInvalidStoredSchedule
	}
	parsed, err := parseCurrentCron(strings.TrimSpace(schedule.Cron))
	if err != nil {
		return time.Time{}, false, ErrInvalidStoredSchedule
	}
	occurrence := parsed.Next(lastRun.In(location))
	if occurrence.IsZero() || occurrence.After(now.In(location)) {
		return time.Time{}, false, nil
	}
	return occurrence.UTC(), true, nil
}

func parseStoredLastRun(value string) (time.Time, error) {
	if value == "" || len(value) > MaxTimezoneBytes ||
		strings.ContainsAny(value, "\x00\r\n") {
		return time.Time{}, ErrInvalidStoredSchedule
	}
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err == nil {
		return parsed.UTC(), nil
	}
	for _, layout := range []string{
		"2006-01-02T15:04:05.999999999",
		"2006-01-02 15:04:05.999999999",
	} {
		parsed, err = time.ParseInLocation(layout, value, time.UTC)
		if err == nil {
			return parsed.UTC(), nil
		}
	}
	return time.Time{}, ErrInvalidStoredSchedule
}
