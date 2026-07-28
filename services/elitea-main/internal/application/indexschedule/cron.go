package indexschedule

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/robfig/cron/v3"
)

var (
	currentFiveFieldParser = cron.NewParser(
		cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow | cron.Descriptor,
	)
	currentSixFieldParser = cron.NewParser(
		cron.Second | cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow,
	)
)

type filteredCronSchedule struct {
	base    cron.Schedule
	matcher *currentSpecialDayMatcher
}

func (schedule filteredCronSchedule) Next(after time.Time) time.Time {
	next := schedule.base.Next(after)
	for !next.IsZero() && !schedule.matcher.matches(next) {
		next = schedule.base.Next(next)
	}
	return next
}

type currentSpecialDayMatcher struct {
	domWildcard     bool
	dowWildcard     bool
	lastDOM         bool
	domRegularField string
	dowRegularField string
	regularDOM      cron.Schedule
	regularDOW      cron.Schedule
	nthDOW          []currentNthWeekday
}

type currentNthWeekday struct {
	weekday time.Weekday
	nth     int
}

func (matcher *currentSpecialDayMatcher) matches(candidate time.Time) bool {
	domMatches := matcher.domWildcard ||
		(matcher.lastDOM && candidate.Day() == lastDayOfMonth(candidate)) ||
		scheduleMatchesAt(matcher.regularDOM, candidate)
	dowMatches := matcher.dowWildcard ||
		scheduleMatchesAt(matcher.regularDOW, candidate) ||
		nthWeekdayMatches(matcher.nthDOW, candidate)
	if matcher.domWildcard || matcher.dowWildcard {
		return domMatches && dowMatches
	}
	return domMatches || dowMatches
}

func ValidateUpdateCron(value string) (string, error) {
	normalized := strings.TrimSpace(value)
	if normalized == "" || len(normalized) > MaxCronBytes ||
		strings.ContainsAny(normalized, "\x00\r\n?") {
		return "", ErrInvalidCron
	}
	schedule, err := parseCurrentCron(normalized)
	if err != nil {
		return "", fmt.Errorf("%w: %v", ErrInvalidCron, err)
	}
	previous := schedule.Next(time.Date(2000, time.January, 1, 0, 0, 0, 0, time.UTC))
	if previous.IsZero() {
		return "", ErrInvalidCron
	}
	for range DailyProbeFirings {
		next := schedule.Next(previous)
		if next.IsZero() {
			return "", ErrInvalidCron
		}
		if next.Sub(previous) < 24*time.Hour {
			return "", ErrFrequencyAboveDaily
		}
		previous = next
	}
	return normalized, nil
}

func ValidateTimezone(value string) error {
	if value == "" || len(value) > MaxTimezoneBytes || value == "Local" ||
		strings.ContainsAny(value, "\x00\r\n") {
		return ErrInvalidTimezone
	}
	if _, err := time.LoadLocation(value); err != nil {
		return ErrInvalidTimezone
	}
	return nil
}

func parseCurrentCron(value string) (cron.Schedule, error) {
	if strings.HasPrefix(value, "@") {
		// croniter aliases are case-insensitive and intentionally do not include
		// robfig's duration-based @every extension.
		switch strings.ToLower(value) {
		case "@midnight", "@hourly", "@daily", "@weekly", "@monthly", "@yearly", "@annually":
			return currentFiveFieldParser.Parse(strings.ToLower(value))
		default:
			return nil, errors.New("unsupported cron descriptor")
		}
	}

	fields := strings.Fields(value)
	if len(fields) != 5 && len(fields) != 6 {
		return nil, errors.New("expected five or six cron fields")
	}
	matcher, transformed, err := currentSpecialDays(fields)
	if err != nil {
		return nil, err
	}
	base, err := parseCurrentFields(transformed)
	if err != nil {
		return nil, err
	}
	if matcher == nil {
		return base, nil
	}
	if err := matcher.compileRegularFields(transformed); err != nil {
		return nil, err
	}
	return filteredCronSchedule{base: base, matcher: matcher}, nil
}

func parseCurrentFields(fields []string) (cron.Schedule, error) {
	fields = append([]string(nil), fields...)
	normalizedDOW, err := expandCurrentRegularDOW(fields[4])
	if err != nil {
		return nil, err
	}
	fields[4] = normalizedDOW
	if len(fields) == 5 {
		return currentFiveFieldParser.Parse(strings.Join(fields, " "))
	}
	// croniter's sixth field is seconds; robfig's is first.
	secondsFirst := []string{
		fields[5], fields[0], fields[1], fields[2], fields[3], fields[4],
	}
	return currentSixFieldParser.Parse(strings.Join(secondsFirst, " "))
}

// croniter 1.4.1 accepts 7 as Sunday and uses an inclusive 0-7 range for the
// day-of-week field. robfig uses 0-6. Expand the regular field into the same
// seven-day set before handing it to robfig.
func expandCurrentRegularDOW(field string) (string, error) {
	selected := [7]bool{}
	for _, item := range strings.Split(strings.ToLower(field), ",") {
		if item == "" {
			return "", errors.New("empty weekday item")
		}
		rangeAndStep := strings.Split(item, "/")
		if len(rangeAndStep) > 2 {
			return "", errors.New("invalid weekday step")
		}
		step := 1
		if len(rangeAndStep) == 2 {
			parsed, err := strconv.Atoi(rangeAndStep[1])
			if err != nil || parsed <= 0 {
				return "", errors.New("invalid weekday step")
			}
			step = parsed
		}

		start, end := 0, 0
		bounds := strings.Split(rangeAndStep[0], "-")
		switch {
		case rangeAndStep[0] == "*":
			start, end = 0, 7
		case len(bounds) == 1:
			value, err := currentRawWeekday(bounds[0])
			if err != nil {
				return "", err
			}
			start, end = value, value
			if len(rangeAndStep) == 2 {
				end = 7
			}
		case len(bounds) == 2:
			var err error
			start, err = currentRawWeekday(bounds[0])
			if err != nil {
				return "", err
			}
			end, err = currentRawWeekday(bounds[1])
			if err != nil {
				return "", err
			}
			if start > end && end == 0 {
				end = 7
			}
			if start > end {
				return "", errors.New("invalid weekday range")
			}
		default:
			return "", errors.New("invalid weekday range")
		}
		for weekday := start; weekday <= end; weekday += step {
			selected[weekday%7] = true
		}
	}

	values := make([]string, 0, len(selected))
	for weekday, present := range selected {
		if present {
			values = append(values, strconv.Itoa(weekday))
		}
	}
	if len(values) == len(selected) {
		return "*", nil
	}
	if len(values) == 0 {
		return "", errors.New("empty weekday field")
	}
	return strings.Join(values, ","), nil
}

func currentRawWeekday(value string) (int, error) {
	if number, err := strconv.Atoi(value); err == nil {
		if number >= 0 && number <= 7 {
			return number, nil
		}
		return 0, errors.New("invalid weekday")
	}
	names := map[string]int{
		"sun": 0,
		"mon": 1,
		"tue": 2,
		"wed": 3,
		"thu": 4,
		"fri": 5,
		"sat": 6,
	}
	weekday, ok := names[value]
	if !ok {
		return 0, errors.New("invalid weekday")
	}
	return weekday, nil
}

func currentSpecialDays(fields []string) (*currentSpecialDayMatcher, []string, error) {
	transformed := append([]string(nil), fields...)
	matcher := &currentSpecialDayMatcher{
		domWildcard: fields[2] == "*",
		dowWildcard: fields[4] == "*",
	}
	hasSpecial := false

	domParts := strings.Split(fields[2], ",")
	regularDOM := make([]string, 0, len(domParts))
	transformedDOM := make([]string, 0, len(domParts))
	for _, part := range domParts {
		if strings.EqualFold(part, "L") {
			hasSpecial = true
			matcher.lastDOM = true
			transformedDOM = append(transformedDOM, "28-31")
			continue
		}
		regularDOM = append(regularDOM, part)
		transformedDOM = append(transformedDOM, part)
	}
	matcher.domRegularField = strings.Join(regularDOM, ",")
	transformed[2] = strings.Join(transformedDOM, ",")

	dowParts := strings.Split(fields[4], ",")
	regularDOW := make([]string, 0, len(dowParts))
	transformedDOW := make([]string, 0, len(dowParts))
	hasNth := false
	for _, part := range dowParts {
		rules, base, special, err := parseCurrentNthWeekday(part)
		if err != nil {
			return nil, nil, err
		}
		if special {
			hasSpecial = true
			hasNth = true
			matcher.nthDOW = append(matcher.nthDOW, rules...)
			transformedDOW = append(transformedDOW, base)
			continue
		}
		regularDOW = append(regularDOW, part)
		transformedDOW = append(transformedDOW, part)
	}
	if hasNth && len(regularDOW) != 0 {
		return nil, nil, errors.New("cannot mix literal and nth weekday syntax")
	}
	matcher.dowRegularField = strings.Join(regularDOW, ",")
	transformed[4] = strings.Join(transformedDOW, ",")
	if !hasSpecial {
		return nil, transformed, nil
	}
	return matcher, transformed, nil
}

func (matcher *currentSpecialDayMatcher) compileRegularFields(fields []string) error {
	if matcher.domRegularField != "" {
		domFields := append([]string(nil), fields...)
		domFields[2] = matcher.domRegularField
		domFields[4] = "*"
		schedule, err := parseCurrentFields(domFields)
		if err != nil {
			return err
		}
		matcher.regularDOM = schedule
	}
	if matcher.dowRegularField != "" {
		dowFields := append([]string(nil), fields...)
		dowFields[2] = "*"
		dowFields[4] = matcher.dowRegularField
		schedule, err := parseCurrentFields(dowFields)
		if err != nil {
			return err
		}
		matcher.regularDOW = schedule
	}
	return nil
}

func parseCurrentNthWeekday(value string) ([]currentNthWeekday, string, bool, error) {
	lower := strings.ToLower(value)
	if strings.HasPrefix(lower, "l") && len(lower) > 1 {
		weekday, err := currentWeekday(lower[1:])
		if err != nil {
			return nil, "", false, err
		}
		return []currentNthWeekday{{weekday: weekday, nth: -1}},
			strconv.Itoa(int(weekday)), true, nil
	}
	hash := strings.LastIndexByte(lower, '#')
	if hash < 0 {
		return nil, value, false, nil
	}
	nth, err := strconv.Atoi(lower[hash+1:])
	if err != nil || nth < 1 || nth > 5 {
		return nil, "", false, errors.New("invalid nth weekday")
	}
	weekdays, err := currentWeekdayRange(lower[:hash])
	if err != nil {
		return nil, "", false, err
	}
	rules := make([]currentNthWeekday, 0, len(weekdays))
	base := make([]string, 0, len(weekdays))
	for _, weekday := range weekdays {
		rules = append(rules, currentNthWeekday{weekday: weekday, nth: nth})
		base = append(base, strconv.Itoa(int(weekday)))
	}
	return rules, strings.Join(base, ","), true, nil
}

func currentWeekdayRange(value string) ([]time.Weekday, error) {
	parts := strings.Split(value, "-")
	if len(parts) == 1 {
		weekday, err := currentWeekday(parts[0])
		return []time.Weekday{weekday}, err
	}
	if len(parts) != 2 {
		return nil, errors.New("invalid weekday range")
	}
	// croniter 1.4.1 accepts named ranges before # (MON-FRI#2), but
	// rejects numeric or mixed ranges (1-5#2 and MON-5#2).
	if _, err := strconv.Atoi(parts[0]); err == nil {
		return nil, errors.New("numeric nth weekday range is unsupported")
	}
	if _, err := strconv.Atoi(parts[1]); err == nil {
		return nil, errors.New("numeric nth weekday range is unsupported")
	}
	first, err := currentWeekday(parts[0])
	if err != nil {
		return nil, err
	}
	last, err := currentWeekday(parts[1])
	if err != nil || first > last {
		return nil, errors.New("invalid weekday range")
	}
	result := make([]time.Weekday, 0, int(last-first)+1)
	for weekday := first; weekday <= last; weekday++ {
		result = append(result, weekday)
	}
	return result, nil
}

func currentWeekday(value string) (time.Weekday, error) {
	if number, err := strconv.Atoi(value); err == nil {
		if number == 7 {
			number = 0
		}
		if number >= 0 && number <= 6 {
			return time.Weekday(number), nil
		}
	}
	names := map[string]time.Weekday{
		"sun": time.Sunday,
		"mon": time.Monday,
		"tue": time.Tuesday,
		"wed": time.Wednesday,
		"thu": time.Thursday,
		"fri": time.Friday,
		"sat": time.Saturday,
	}
	weekday, ok := names[value]
	if !ok {
		return 0, errors.New("invalid weekday")
	}
	return weekday, nil
}

func nthWeekdayMatches(rules []currentNthWeekday, candidate time.Time) bool {
	for _, rule := range rules {
		if candidate.Weekday() != rule.weekday {
			continue
		}
		if rule.nth == -1 {
			if candidate.AddDate(0, 0, 7).Month() != candidate.Month() {
				return true
			}
			continue
		}
		if ((candidate.Day()-1)/7)+1 == rule.nth {
			return true
		}
	}
	return false
}

func scheduleMatchesAt(schedule cron.Schedule, candidate time.Time) bool {
	if schedule == nil {
		return false
	}
	return schedule.Next(candidate.Add(-time.Second)).Equal(candidate)
}

func lastDayOfMonth(value time.Time) int {
	return time.Date(value.Year(), value.Month()+1, 0, 0, 0, 0, 0, value.Location()).Day()
}
