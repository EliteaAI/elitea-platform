// The deployment side of issue #468: one embedding model name, one writer.
//
// deploy/scripts/standalone-stack.sh stores the embedding model name in two
// places, and two steps put it there:
//
//   - `seed-llm` seeds the provider credential, the chat model row and the
//     embedding model row;
//   - `seed-index` seeds the vector store, the same embedding model row and an
//     indexable toolkit whose settings hold the name a SECOND time.
//
// Until #468 the two steps read two DIFFERENT environment variables for that
// one name — LLM_EMBEDDING_MODEL and INDEX_EMBEDDING_MODEL — and both wrote
// `data` on the same row, under `ON CONFLICT (elitea_title) DO UPDATE`. The
// step that ran last overwrote the other step's name.
//
// The two defaults agree only for the `mock` provider. Every default run and
// every continuous-integration job uses the mock, so no gate could see the
// divergence. That is why these cases assert the SHAPE of the script instead of
// the outcome of a mock run.
//
// The failure the shape prevents is not a loud one. elitea-main binds an index
// run by matching configuration.data->>'name' (db/queries/configurations.sql,
// FindCurrentEmbeddingConfigurations). A name that no row carries still admits
// the run, and the run then dies in the worker with a gateway 404.
//
// This file reads deploy/scripts/standalone-stack.sh as text. That file lives
// outside this Go module, so the test cache cannot see an edit to it. Run this
// package with -count=1, as tests/deployedge and tests/vaultparity do.
package seedparity_test

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// standaloneStackScript returns the seed script's text.
func standaloneStackScript(t *testing.T) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(repoRoot(t), "deploy", "scripts", "standalone-stack.sh"))
	if err != nil {
		t.Fatalf("read deploy/scripts/standalone-stack.sh: %v", err)
	}
	if len(raw) == 0 {
		t.Fatal("deploy/scripts/standalone-stack.sh is empty; an empty read is not a clean result")
	}
	return string(raw)
}

// repoRoot walks up from the test's directory to the repository root. It keys
// on the seed script itself, so a move of that file fails here rather than
// producing a silent skip.
func repoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "deploy", "scripts", "standalone-stack.sh")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatal("deploy/scripts/standalone-stack.sh not found in any parent directory")
		}
		dir = parent
	}
}

// embeddingVarAssignment matches a shell assignment whose value comes from an
// environment variable whose name ends in EMBEDDING_MODEL.
// It is deliberately not anchored to the start of a line: the resolver assigns
// inside `case` branches, which put the assignment after the pattern label.
var embeddingVarAssignment = regexp.MustCompile(`[A-Za-z_][A-Za-z0-9_]*="?\$\{([A-Za-z_][A-Za-z0-9_]*EMBEDDING_MODEL)`)

// authoritativeEmbeddingVar is the one variable that may name the model.
// `seed-llm` seeds the credential, so it is the only step that knows which
// provider must serve the model. The name therefore belongs to the LLM step.
const authoritativeEmbeddingVar = "LLM_EMBEDDING_MODEL"

// A second variable for one value is the root of #468. Rejecting a retired
// name is allowed — the script still tests INDEX_EMBEDDING_MODEL so it can
// refuse a run that sets it — but no step may take a VALUE from it.
func TestOneEnvironmentVariableNamesTheEmbeddingModel(t *testing.T) {
	script := standaloneStackScript(t)

	matches := embeddingVarAssignment.FindAllStringSubmatch(script, -1)
	if len(matches) == 0 {
		t.Fatal("no assignment reads an *EMBEDDING_MODEL variable; the search found nothing, which is not a clean result")
	}

	seen := map[string]bool{}
	for _, match := range matches {
		seen[match[1]] = true
	}
	for name := range seen {
		if name != authoritativeEmbeddingVar {
			t.Errorf("standalone-stack.sh takes the embedding model name from %q as well as %q; "+
				"two variables for one row let the last seed step win (#468)",
				name, authoritativeEmbeddingVar)
		}
	}
}

// sqlStatements splits the script into the SQL statements that start with
// INSERT INTO. Each result runs to the first ';'.
func sqlStatements(script, target string) []string {
	var found []string
	for _, part := range strings.Split(script, "INSERT INTO ")[1:] {
		statement := part
		if end := strings.Index(part, ";"); end >= 0 {
			statement = part[:end]
		}
		if strings.HasPrefix(strings.TrimSpace(statement), target) {
			found = append(found, statement)
		}
	}
	return found
}

// conflictAction returns the text after ON CONFLICT, which is where a statement
// says what it overwrites.
func conflictAction(statement string) string {
	start := strings.Index(statement, "ON CONFLICT")
	if start < 0 {
		return ""
	}
	return statement[start:]
}

// writesData reports whether a conflict action overwrites the `data` column.
var writesData = regexp.MustCompile(`\bdata\s*=`)

// The core case. Two steps may both create the row, but only ONE may write the
// model name into it. `seed-index` keeps the row's `data` and so provisions a
// complete index plane without taking the name away from `seed-llm`.
//
// Against the script before this fix the message is:
//
//	two statements overwrite `data` on the 'standalone-embedding'
//	configuration row; the seed step that runs last then decides the
//	embedding model name (#468)
func TestOnlyOneStatementWritesTheEmbeddingModelName(t *testing.T) {
	script := standaloneStackScript(t)

	statements := sqlStatements(script, `:"schema".configuration`)
	if len(statements) == 0 {
		t.Fatal("no INSERT into the configuration table found; the search found nothing, which is not a clean result")
	}

	rows := 0
	writers := 0
	for _, statement := range statements {
		if !strings.Contains(statement, "'standalone-embedding'") {
			continue
		}
		rows++
		if writesData.MatchString(conflictAction(statement)) {
			writers++
		}
	}

	if rows == 0 {
		t.Fatal("no INSERT seeds the 'standalone-embedding' configuration row; the search found nothing, which is not a clean result")
	}

	// The writer MOVED. seed-llm no longer writes this row with SQL — it goes
	// through POST/PUT /api/v2/configurations in seed-llm-api.py — so the SQL
	// writer count is now legitimately zero, while seed-index's INSERT (which
	// keeps `data`) still seeds the row.
	//
	// The invariant #468 is about is unchanged and still worth pinning: exactly
	// ONE thing decides the embedding model name. Counting only SQL would let a
	// second API writer appear unnoticed, and counting only the API would let a
	// re-added `ON CONFLICT … data =` slip back in. So both mechanisms are
	// counted, and the total must be one.
	writers += apiEmbeddingModelWriters(t)

	if writers != 1 {
		t.Errorf("%d writer(s) decide `data` on the 'standalone-embedding' configuration row "+
			"(SQL statements plus seed-llm-api.py payloads); the step that runs last then decides "+
			"the embedding model name (#468)", writers)
	}
}

// apiEmbeddingModelWriters counts the payloads in seed-llm-api.py that set the
// embedding row's `data`. The script is the successor to the retired SQL, so a
// second writer added there is the same defect #468 named, wearing a different
// mechanism.
func apiEmbeddingModelWriters(t *testing.T) int {
	t.Helper()

	path := filepath.Join(repoRoot(t), "deploy", "scripts", "seed-llm-api.py")
	source, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read seed-llm-api.py: %v; the search found nothing, which is not a clean result", err)
	}

	// A payload that names the row AND carries the model name under `data`.
	writer := regexp.MustCompile(`(?s)"elitea_title":\s*"standalone-embedding".{0,400}?"data":\s*\{[^}]*"name"`)
	found := len(writer.FindAllIndex(source, -1))
	if found == 0 {
		t.Fatal("no payload in seed-llm-api.py writes the 'standalone-embedding' row's data.name; " +
			"the search found nothing, which is not a clean result")
	}
	return found
}

// The toolkit holds the name a second time, in elitea_tools.settings. That copy
// must be READ OUT of the configuration row in SQL. A copy of the shell
// variable makes the two agree only when both steps run with the same
// environment, which is the same defect one table over.
//
// Against the script before this fix the message is:
//
//	the index toolkit takes settings.embedding_model from the shell
//	variable :'embedding'; read it from the configuration row instead, so
//	the two stored names cannot disagree (#468)
func TestToolkitReadsTheEmbeddingNameFromTheConfigurationRow(t *testing.T) {
	script := standaloneStackScript(t)

	statements := sqlStatements(script, `:"schema".elitea_tools`)
	if len(statements) == 0 {
		t.Fatal("no INSERT into elitea_tools found; the search found nothing, which is not a clean result")
	}

	for _, statement := range statements {
		if !strings.Contains(statement, "'embedding_model'") {
			continue
		}
		if strings.Contains(statement, `'embedding_model', :'embedding'`) {
			t.Error("the index toolkit takes settings.embedding_model from the shell variable :'embedding'; " +
				"read it from the configuration row instead, so the two stored names cannot disagree (#468)")
		}
		if !strings.Contains(statement, `'embedding_model', c.data->>'name'`) {
			t.Error("the index toolkit does not build settings.embedding_model from the configuration row's " +
				"own data->>'name'; the index resolver matches on that column (#468)")
		}
	}
}
