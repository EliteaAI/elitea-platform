package eliteacore

// Unit coverage for the `?format=md` renderer (export_markdown.go).
//
// These run without a database, because every one of them is a claim about a
// pure function from the export document to the file's bytes. The dispatch
// itself — that the ROUTE honours `format=md` at all, which is the defect this
// work exists to repair — is asserted against a real PostgreSQL in
// export_markdown_postgres_integration_test.go.
//
// Each case here is one way the file could be wrong while still looking like a
// plausible markdown export.

import (
	"archive/zip"
	"bytes"
	"net/http/httptest"
	"strings"
	"testing"
)

func agentVersion() map[string]any {
	return map[string]any{
		"name":         "base",
		"agent_type":   "react",
		"instructions": "Answer briefly.",
		"llm_settings": map[string]any{
			"model_name":  "gpt-4o",
			"temperature": 0.0,
			"max_tokens":  float64(2048),
			"top_p":       0.0,
		},
		"meta":  map[string]any{"step_limit": float64(12)},
		"tools": []any{map[string]any{"import_uuid": "tk-1"}},
	}
}

func agentDocument(version map[string]any) map[string]any {
	return map[string]any{
		"applications": []map[string]any{{
			"name":        "Support Bot",
			"description": "Answers support questions.",
			"versions":    []any{version},
		}},
		"toolkits": []any{map[string]any{
			"name":        "Postgres",
			"type":        "pgvector",
			"import_uuid": "tk-1",
			"settings": map[string]any{
				"pgvector_configuration": map[string]any{
					"elitea_title":       "shared index",
					"configuration_type": "pgvector",
					"connection_string":  "postgres://user:hunter2@db/prod",
					"private":            true,
				},
				"configuration_uuid": "cfg-9",
				"selected_tools":     []any{"similarity_search"},
			},
		}},
	}
}

func renderOne(t *testing.T, document map[string]any) exportedFile {
	t.Helper()
	files, err := markdownFilesFor(document)
	if err != nil {
		t.Fatalf("markdownFilesFor: %v", err)
	}
	if len(files) != 1 {
		t.Fatalf("rendered %d files, want 1", len(files))
	}
	return files[0]
}

// The frontmatter is ordered, and the body is the agent's instructions. A map
// would emit these alphabetically — `agent_type` first, `name` fourth — which
// parses identically and reads nothing like the format the legacy produced.
func TestMarkdownExportWritesOrderedFrontmatterAndTheInstructionsBody(t *testing.T) {
	file := renderOne(t, agentDocument(agentVersion()))

	if !strings.HasPrefix(file.content, "---\nname: Support Bot\ndescription: Answers support questions.\n") {
		t.Errorf("frontmatter does not open with name then description:\n%s", file.content)
	}
	if !strings.HasSuffix(file.content, "---\n\nAnswer briefly.") {
		t.Errorf("the body must be the instructions, verbatim and last:\n%s", file.content)
	}

	order := []string{"name:", "description:", "model:", "temperature:", "max_tokens:", "top_p:", "agent_type:", "step_limit:", "toolkits:"}
	previous := -1
	for _, key := range order {
		at := strings.Index(file.content, "\n"+key)
		if at < 0 {
			t.Fatalf("frontmatter has no %q:\n%s", key, file.content)
		}
		if at < previous {
			t.Errorf("%q appears out of order:\n%s", key, file.content)
		}
		previous = at
	}
}

// A temperature of 0 is a real setting — "always answer deterministically" —
// and the legacy guards it with `is not None` for exactly that reason. Dropped
// as falsy, the import silently re-defaults the agent to something else.
func TestMarkdownExportKeepsAZeroTemperatureAndTopP(t *testing.T) {
	file := renderOne(t, agentDocument(agentVersion()))

	if !strings.Contains(file.content, "\ntemperature: 0\n") {
		t.Errorf("a temperature of 0 was dropped as if it were absent:\n%s", file.content)
	}
	if !strings.Contains(file.content, "\ntop_p: 0\n") {
		t.Errorf("a top_p of 0 was dropped as if it were absent:\n%s", file.content)
	}
}

// The export is a file a person mails to a colleague. A database password in
// it is the kind of leak that is only ever noticed after the fact.
func TestMarkdownExportDropsTheConnectionStringAndInternalKeys(t *testing.T) {
	file := renderOne(t, agentDocument(agentVersion()))

	if strings.Contains(file.content, "hunter2") || strings.Contains(file.content, "connection_string") {
		t.Errorf("the pgvector connection string reached the exported file:\n%s", file.content)
	}
	// The allow-list keeps what identifies the index to a human...
	if !strings.Contains(file.content, "elitea_title: shared index") {
		t.Errorf("the pgvector title should survive the sanitiser:\n%s", file.content)
	}
	// ...and `private` is forced false so the file imports into any project.
	if !strings.Contains(file.content, "private: false") {
		t.Errorf("private must be exported as false, not as the source project's true:\n%s", file.content)
	}
	if strings.Contains(file.content, "configuration_uuid") {
		t.Errorf("a project-local configuration id reached the exported file:\n%s", file.content)
	}
	// `selected_tools` is excluded from `settings` but re-surfaces as the
	// block's own `tools` key — dropping it entirely would export a toolkit
	// with every tool enabled.
	if !strings.Contains(file.content, "similarity_search") {
		t.Errorf("the tool selection was lost:\n%s", file.content)
	}
}

// A pipeline's instructions are YAML that belongs in the frontmatter; leaving
// them in the body produces a file whose graph no importer can read.
func TestMarkdownExportLiftsPipelineInstructionsIntoFrontmatter(t *testing.T) {
	version := agentVersion()
	version["agent_type"] = "pipeline"
	version["instructions"] = "entry_point: start\nnodes:\n  - id: start\n    import_uuid: drop-me\n"

	file := renderOne(t, agentDocument(version))

	if !strings.Contains(file.content, "entry_point: start") {
		t.Errorf("the pipeline entry point stayed out of the frontmatter:\n%s", file.content)
	}
	if !strings.HasSuffix(file.content, "---\n\n") {
		t.Errorf("a pipeline has no body; everything is frontmatter:\n%s", file.content)
	}
	if strings.Contains(file.content, "drop-me") {
		t.Errorf("internal keys must be filtered from pipeline nodes too:\n%s", file.content)
	}
	if !strings.HasSuffix(file.name, ".pipeline.md") {
		t.Errorf("filename = %q, want the .pipeline.md suffix", file.name)
	}
}

// Invalid YAML is not an error: the legacy swallows it and still writes the
// toolkits and settings. A 400 here would refuse to export a pipeline whose
// instructions a person can still read.
func TestMarkdownExportStillWritesAPipelineWithUnparseableInstructions(t *testing.T) {
	version := agentVersion()
	version["agent_type"] = "pipeline"
	version["instructions"] = "nodes: [unclosed"

	file := renderOne(t, agentDocument(version))

	if !strings.Contains(file.content, "toolkits:") {
		t.Errorf("the toolkits must survive unparseable instructions:\n%s", file.content)
	}
}

// One file per VERSION. A single response cannot carry two documents, and
// sending only the first would lose every version but one — silently, since a
// one-version file is exactly what a correct single-version export looks like.
func TestMarkdownExportZipsMoreThanOneVersion(t *testing.T) {
	second := agentVersion()
	second["name"] = "Release Candidate"
	document := agentDocument(agentVersion())
	apps, _ := document["applications"].([]map[string]any)
	apps[0]["versions"] = []any{agentVersion(), second}

	recorder := httptest.NewRecorder()
	writeMarkdownExport(recorder, "7", document)

	if got := recorder.Header().Get("Content-Type"); got != "application/zip" {
		t.Fatalf("Content-Type = %q, want application/zip", got)
	}
	archive, err := zip.NewReader(bytes.NewReader(recorder.Body.Bytes()), int64(recorder.Body.Len()))
	if err != nil {
		t.Fatalf("the response is not a readable zip: %v", err)
	}
	names := make([]string, 0, len(archive.File))
	for _, entry := range archive.File {
		names = append(names, entry.Name)
	}
	if len(names) != 2 {
		t.Fatalf("the archive holds %v, want one entry per version", names)
	}
	// The base version is unqualified; a named version carries its own slug,
	// or two versions of one agent would collide on a single filename.
	if names[0] != "support-bot.agent.md" || names[1] != "support-bot.release-candidate.agent.md" {
		t.Errorf("archive entries = %v, want the base and the slugged version", names)
	}
}

// A single file goes out as markdown, named, and with the header the browser
// needs to see the name at all.
func TestMarkdownExportSendsOneFileAsMarkdownWithItsName(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeMarkdownExport(recorder, "7", agentDocument(agentVersion()))

	if got := recorder.Header().Get("Content-Type"); got != "text/markdown; charset=utf-8" {
		t.Errorf("Content-Type = %q — the client saves this blob as .md", got)
	}
	if got := recorder.Header().Get("Content-Disposition"); got != `attachment; filename="support-bot.agent.md"` {
		t.Errorf("Content-Disposition = %q", got)
	}
	// Without this the browser cannot READ Content-Disposition cross-origin,
	// so the download falls back to the client's own guessed filename.
	if got := recorder.Header().Get("Access-Control-Expose-Headers"); got != "Content-Disposition" {
		t.Errorf("Access-Control-Expose-Headers = %q, want Content-Disposition", got)
	}
}

func TestSlugifyMatchesTheLegacyRules(t *testing.T) {
	for _, testCase := range []struct{ in, want string }{
		{"Support Bot", "support-bot"},
		{"  Trim  Me  ", "trim-me"},
		{"Punct!u@ation#", "punctuation"},
		{"multi   space", "multi-space"},
		{"already-hyphenated", "already-hyphenated"},
		{strings.Repeat("a", 80), strings.Repeat("a", 50)},
	} {
		if got := slugify(testCase.in); got != testCase.want {
			t.Errorf("slugify(%q) = %q, want %q", testCase.in, got, testCase.want)
		}
	}
}

// A name that slugs to nothing must still produce a usable filename rather
// than a file called ".agent.md", which is hidden on every unix desktop.
func TestMarkdownFilenameFallsBackForANameThatSlugsToNothing(t *testing.T) {
	if got := markdownFilename("日本語", "base", "react"); got != "application.agent.md" {
		t.Errorf("markdownFilename = %q, want the application fallback", got)
	}
}
