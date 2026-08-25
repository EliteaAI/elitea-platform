package projectprovisioning

// ReferencingTables names every table the delete path clears before it removes
// the project row.
//
// It is exported to the test binary only. The coverage test compares it with
// the live catalogue, so a migration that adds a foreign key to
// centry.project(id) fails that test until the new table appears in
// referencingDeletes.
func ReferencingTables() []string {
	cleanups := referencingDeletes()
	tables := make([]string, 0, len(cleanups))
	for _, cleanup := range cleanups {
		tables = append(tables, cleanup.table)
	}
	return tables
}

// HeldBackStepMessage is the step message a held-back schema drop carries.
// The delete tests assert on it, so that a step reported as "did not complete"
// cannot pass as a step that was deliberately not started.
func HeldBackStepMessage(step string) string { return heldBackStepMessage(step) }
