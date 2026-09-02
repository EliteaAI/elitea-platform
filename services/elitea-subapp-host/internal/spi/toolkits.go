package spi

import (
	"fmt"
	"strings"
)

// Toolkit admission: which toolkit names a request may address, which
// family each belongs to, and which tools that family serves. The data is
// the sub-application's; the mechanism — and the two different refusals the
// legacy plugin raised, which the frozen error fixture keeps apart — is the
// host's.

// Family groups toolkit aliases that share a tool set.
type Family struct {
	// Name is the family's identifier (the legacy "main", "query", …).
	Name string
	// Aliases are the toolkit names that resolve to this family, matched
	// case-sensitively: only some are advertised by the descriptor, the rest
	// exist for user data created before renames.
	Aliases []string
	// Tools are the tools the family serves.
	Tools []string
	// UnknownToolIsInvalidInput selects the refusal for a tool the family
	// does not serve. The legacy plugin's main family raised
	// FileNotFoundError (resource_not_found, "Unknown tool: x"); the query
	// families raised ValueError (invalid_input, "Tool 'x' not available in
	// <label> toolkit. Available: …"). Label is the name in that message.
	UnknownToolIsInvalidInput bool
	Label                     string
}

// Toolkits is a sub-application's admission table.
type Toolkits struct {
	Families []Family
	// Advertised are the names the descriptor declares; every one must resolve.
	Advertised []string
}

// AllNames lists every alias, in table order.
func (t Toolkits) AllNames() []string {
	var out []string
	for _, family := range t.Families {
		out = append(out, family.Aliases...)
	}
	return out
}

// Resolve returns the family a toolkit name belongs to, or a not-found
// failure whose message names every accepted alias — the legacy text.
func (t Toolkits) Resolve(toolkit string) (Family, error) {
	for _, family := range t.Families {
		for _, alias := range family.Aliases {
			if alias == toolkit {
				return family, nil
			}
		}
	}
	return Family{}, Failf(KindNotFound, "Unknown toolkit: %s. Expected: one of %s", toolkit, pythonList(t.AllNames()))
}

// Admit checks that the family serves the tool.
func (t Toolkits) Admit(family Family, tool string) error {
	for _, known := range family.Tools {
		if known == tool {
			return nil
		}
	}
	if family.UnknownToolIsInvalidInput {
		return Failf(KindValue, "Tool '%s' not available in %s toolkit. Available: %s", tool, family.Label, strings.Join(family.Tools, ", "))
	}
	return Failf(KindNotFound, "Unknown tool: %s", tool)
}

// Validate refuses a table with no families, a family with no aliases or
// tools, an alias in two families, or an advertised name that resolves to
// nothing — each of which would refuse every invocation at runtime instead.
func (t Toolkits) Validate() error {
	if len(t.Families) == 0 {
		return fmt.Errorf("%w: a sub-application needs at least one toolkit family", ErrConfig)
	}
	seen := map[string]string{}
	for _, family := range t.Families {
		if family.Name == "" || len(family.Aliases) == 0 || len(family.Tools) == 0 {
			return fmt.Errorf("%w: family %q needs a name, aliases and tools", ErrConfig, family.Name)
		}
		if family.UnknownToolIsInvalidInput && family.Label == "" {
			return fmt.Errorf("%w: family %q refuses unknown tools by label and has none", ErrConfig, family.Name)
		}
		for _, alias := range family.Aliases {
			if other, dup := seen[alias]; dup {
				return fmt.Errorf("%w: toolkit alias %q is in families %q and %q", ErrConfig, alias, other, family.Name)
			}
			seen[alias] = family.Name
		}
	}
	for _, name := range t.Advertised {
		if _, err := t.Resolve(name); err != nil {
			return fmt.Errorf("%w: advertised toolkit %q resolves to no family", ErrConfig, name)
		}
	}
	return nil
}

// pythonList renders names the way Python's repr of a list of str does —
// the legacy message carried exactly that, and the fixture records it.
func pythonList(names []string) string {
	quoted := make([]string, len(names))
	for i, name := range names {
		quoted[i] = "'" + name + "'"
	}
	return "[" + strings.Join(quoted, ", ") + "]"
}
