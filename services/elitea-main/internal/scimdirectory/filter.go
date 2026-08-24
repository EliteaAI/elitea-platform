package scimdirectory

// The SCIM filter subset this directory answers.
//
// # Why a subset, and why an unsupported filter is REFUSED
//
// RFC 7644 §3.4.2.2 defines a full expression language: grouping, `and`/`or`
// /`not`, complex attribute paths, and nine operators. Almost none of it is
// used in practice — an identity provider provisioning users sends
// `userName eq "…"` to find out whether it has already created someone, and
// `externalId eq "…"` to find what it created.
//
// The dangerous half is not the parsing, it is what a server does with a filter
// it does not understand. Returning the WHOLE directory is the obvious
// implementation and the worst one: the client asked "is there an account with
// this address", got a list with somebody else at the top, and updates the wrong
// person's row. So an expression this file cannot represent is refused with 400
// and the reason, never approximated and never ignored.
//
// # What is supported
//
//	userName    eq | ne | co | sw | ew  "value"
//	externalId  eq | ne | co | sw | ew  "value"
//	displayName eq | ne | co | sw | ew  "value"
//	id          eq                      "value"
//	active      eq | ne                 true | false
//
// Attribute names are matched case-insensitively, as RFC 7644 requires. Nothing
// else is: no `and`, no `or`, no `not`, no `pr`, no grouping. Each of those is a
// separate, testable addition, and each would be a lie if it were accepted and
// half-applied.

import (
	"fmt"
	"strconv"
	"strings"
)

// Filter is one parsed comparison, or the empty filter that matches everything.
type Filter struct {
	attribute string
	operator  string
	value     string
	// present is false for the empty filter. A zero Filter must match
	// everything, because "no filter" is how a client asks for the whole
	// directory — and a zero value that matched nothing would answer that
	// request with an empty page.
	present bool
}

// UnsupportedFilterError names the expression this directory cannot represent.
//
// It is a distinct type so the HTTP layer answers 400 with `scimType:
// invalidFilter`, which is the code RFC 7644 defines for exactly this, and
// keeps every other failure a 500.
type UnsupportedFilterError struct {
	Expression string
	Reason     string
}

func (e UnsupportedFilterError) Error() string {
	return fmt.Sprintf("unsupported filter %q: %s", e.Expression, e.Reason)
}

// filterableAttributes maps the SCIM attribute name to its column, and is the
// closed set this parser accepts.
var filterableAttributes = map[string]string{
	"username":    "lower(account.email)",
	"externalid":  "COALESCE(scim.external_id, '')",
	"displayname": "COALESCE(account.name, '')",
	"id":          "account.id::text",
	"active":      "NOT account.suspended",
}

// ParseFilter reads one `filter` query parameter.
//
// An empty string is the empty filter, not an error: a listing with no filter is
// the ordinary way to page the whole directory.
func ParseFilter(expression string) (Filter, error) {
	trimmed := strings.TrimSpace(expression)
	if trimmed == "" {
		return Filter{}, nil
	}

	// Refused BY NAME rather than by falling through to a parse failure, so the
	// message tells an operator which construct is missing instead of
	// "malformed filter" for a filter that is perfectly well formed.
	for _, unsupported := range []string{" and ", " or ", "not(", "(", "["} {
		if strings.Contains(strings.ToLower(trimmed), unsupported) {
			return Filter{}, UnsupportedFilterError{
				Expression: expression,
				Reason: "this directory answers one comparison at a time: " +
					"grouping and the and/or/not operators are not implemented",
			}
		}
	}

	parts := strings.SplitN(trimmed, " ", 3)
	if len(parts) != 3 {
		return Filter{}, UnsupportedFilterError{
			Expression: expression,
			Reason:     "expected an expression of the form `attribute operator value`",
		}
	}

	attribute := strings.ToLower(parts[0])
	if _, ok := filterableAttributes[attribute]; !ok {
		return Filter{}, UnsupportedFilterError{
			Expression: expression,
			Reason:     "this directory can only filter on userName, externalId, displayName, id and active",
		}
	}

	operator := strings.ToLower(parts[1])
	value := strings.TrimSpace(parts[2])
	// A quoted value is the RFC's form. Unquoted is accepted for `active`,
	// whose values are the bare literals `true` and `false`.
	if unquoted, err := strconv.Unquote(value); err == nil {
		value = unquoted
	}

	if attribute == "active" {
		if operator != "eq" && operator != "ne" {
			return Filter{}, UnsupportedFilterError{
				Expression: expression,
				Reason:     "active can only be compared with eq or ne",
			}
		}
		if value != "true" && value != "false" {
			return Filter{}, UnsupportedFilterError{
				Expression: expression,
				Reason:     "active can only be compared with true or false",
			}
		}
		return Filter{attribute: attribute, operator: operator, value: value, present: true}, nil
	}

	switch operator {
	case "eq", "ne", "co", "sw", "ew":
	default:
		return Filter{}, UnsupportedFilterError{
			Expression: expression,
			Reason:     "this directory implements the eq, ne, co, sw and ew operators",
		}
	}
	if attribute == "id" && operator != "eq" {
		return Filter{}, UnsupportedFilterError{
			Expression: expression,
			Reason:     "id can only be compared with eq",
		}
	}
	return Filter{attribute: attribute, operator: operator, value: value, present: true}, nil
}

// clause renders the filter as SQL and its arguments.
//
// The value is ALWAYS a bound parameter. It arrives from a query string on an
// authenticated but externally-controlled request, and the column is chosen from
// the closed map above — so neither half of the comparison is ever concatenated
// from caller input.
func (f Filter) clause() (string, []any) {
	if !f.present {
		return "", nil
	}
	column := filterableAttributes[f.attribute]

	if f.attribute == "active" {
		wanted := f.value == "true"
		if f.operator == "ne" {
			wanted = !wanted
		}
		return " WHERE (" + column + ") = $1", []any{wanted}
	}

	// Comparison is case-insensitive on both sides. SCIM defines `userName` as
	// case-insensitive, and an identity provider that created `Alice@corp.com`
	// and later filters on `alice@corp.com` must find it — a case-sensitive
	// match would report no such user and the client would create a second
	// account.
	pattern := strings.ToLower(f.value)
	switch f.operator {
	case "eq":
		return " WHERE lower(" + column + ") = $1", []any{pattern}
	case "ne":
		return " WHERE lower(" + column + ") <> $1", []any{pattern}
	case "co":
		return " WHERE lower(" + column + ") LIKE $1", []any{"%" + escapeLike(pattern) + "%"}
	case "sw":
		return " WHERE lower(" + column + ") LIKE $1", []any{escapeLike(pattern) + "%"}
	default: // "ew"
		return " WHERE lower(" + column + ") LIKE $1", []any{"%" + escapeLike(pattern)}
	}
}

// escapeLike neutralises the wildcards a caller could otherwise smuggle into a
// substring match.
//
// Without it, a `co` filter of `%` matches every account, which turns "does an
// account containing this string exist" into "yes" for any string. The escape
// character is the backslash, which is PostgreSQL's default for LIKE.
func escapeLike(value string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return replacer.Replace(value)
}
