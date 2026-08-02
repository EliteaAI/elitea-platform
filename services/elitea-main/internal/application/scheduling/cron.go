package scheduling

import (
	"fmt"

	"github.com/robfig/cron/v3"
)

var cronParser = cron.NewParser(
	cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow | cron.Descriptor,
)

// ParseCron parses the current five-field cron contract. CRON_TZ/TZ prefixes
// are handled by robfig/cron and keep DST behavior inside the immutable
// schedule revision chosen by the caller.
func ParseCron(expression string) (Schedule, error) {
	schedule, err := cronParser.Parse(expression)
	if err != nil {
		return nil, fmt.Errorf("parse scheduled job cron: %w", err)
	}
	return schedule, nil
}
