package run

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-subapp-host/internal/spi"
)

// The fixture runner: the real composition and upload over canned results.
// RUNNER=fixture is for a stack that must exercise the whole generate →
// land → read path — the facade's credential and callback handling, this
// host's composition and upload, the bucket, the wiki browser — without the
// analysis engine, a git host or a model. The browser journeys run against
// it. What is canned is only what the engine would have computed; the wiki
// is deterministic and derived from the request, so a test can predict the
// keys that land: {owner}--{repo}--{branch}/…. One page carries a mermaid
// block that does not parse, on purpose — it is what the quick-fix journey
// repairs.

// Steps is what each fixture tool emits before it answers, in order, down
// the one channel the SPI has (`thinking`). Most entries are progress text
// and the UI's thinking log renders them verbatim; deep_research's second
// entry is a STRUCTURED EVENT instead — see ResearchTodos.
var Steps = map[string][]string{
	"generate_wiki": {"Cloning the repository", "Indexing 12 files", "Planning the wiki structure", "Writing 3 pages", "Assembling the manifest"},
	"ask":           {"Searching the wiki index", "Composing the answer"},
	"deep_research": {"Planning the research", TodoUpdateEvent(ResearchTodos), "Reading the relevant pages", "Writing the report"},
}

// ResearchTodos is the plan a fixture deep_research run publishes.
//
// WHY THE FIXTURE HAS ONE AT ALL. The browser's research panel
// (ResearchTodosPanel) renders whatever the run's `todo_update` events
// carry, and it renders NOTHING when there are none — correct for `ask`, and
// indistinguishable from a panel that is wired up wrong. Until this list
// existed no end-to-end test could tell those two apart, so the panel
// shipped with unit tests and no journey. DWIKI-012b is that journey, and
// this is what it asserts against.
//
// THE SHAPE IS THE ENGINE'S, as the browser receives it. The real path is
// TodoListMiddleware → the research engine's `todo_update` →
// `[TODO_UPDATE] …` on the worker's stdout → tool_operations.py's
// normalisation into `{id, title, description, status}`. Emitting the
// pre-normalisation `content` key instead would render as "Untitled step"
// and pin the wrong contract.
var ResearchTodos = []map[string]any{
	{"id": 1, "title": "Plan the research", "description": "", "status": "completed"},
	{"id": 2, "title": "Read the relevant pages", "description": "", "status": "in_progress"},
	{"id": 3, "title": "Write the report", "description": "", "status": "pending"},
}

// TodoUpdateEvent is a todo list wrapped in the thinking message the browser
// reads it out of. The chat reducer looks for `{event, data}` JSON in the
// event text and routes `todo_update` to the research panel; text it cannot
// parse falls through to the thinking log as a log line, so a mis-shaped
// envelope here degrades silently rather than failing.
func TodoUpdateEvent(todos []map[string]any) string {
	event, _ := json.Marshal(map[string]any{"event": "todo_update", "data": map[string]any{"items": todos}})
	return string(event)
}

// BrokenMermaidPage is the page the quick-fix journey repairs.
const BrokenMermaidPage = "# Request flow\n\nThe diagram below is deliberately broken: the fixture exists so the quick fix\nhas something to repair.\n\n```mermaid\ngraph TD\n  A[Client] -->\n```\n\nAfter the diagram.\n"

// WikiIDFor is the canonical {owner}--{repo}--{branch} the engine derives.
func WikiIDFor(repoConfig map[string]any, branch string) string {
	repository := str(repoConfig["repository"])
	if repository == "" {
		repository = str(object(repoConfig["provider_config"])["repository"])
	}
	repository = strings.Trim(strings.TrimSpace(repository), "/")
	if repository == "" {
		repository = "fixture/repository"
	}
	branch = strings.TrimSpace(branch)
	if branch == "" {
		branch = "main"
	}
	return strings.ReplaceAll(repository, "/", "--") + "--" + branch
}

// FixtureTools is the canned tool table.
func FixtureTools(step time.Duration) map[string]Tool {
	paced := func(name string, tool func(arguments map[string]any) map[string]any) Tool {
		return func(ctx context.Context, arguments map[string]any, tc *spi.Context) (map[string]any, error) {
			for _, progress := range Steps[name] {
				// The checkpoint is what makes Stop work mid-run: a cancelled
				// invocation returns here instead of finishing and uploading.
				if err := tc.Checkpoint(); err != nil {
					return nil, err
				}
				if err := tc.Thinking(ctx, progress); err != nil {
					return nil, err
				}
				if step > 0 {
					select {
					case <-time.After(step):
					case <-ctx.Done():
						return nil, ctx.Err()
					}
				}
			}
			return tool(arguments), nil
		}
	}
	return map[string]Tool{
		"generate_wiki": paced("generate_wiki", fixtureGenerateWiki),
		"ask":           paced("ask", fixtureAsk),
		"deep_research": paced("deep_research", fixtureDeepResearch),
	}
}

func fixtureGenerateWiki(arguments map[string]any) map[string]any {
	query := str(arguments["query"])
	branch := str(firstTruthy(arguments["active_branch"], "main"))
	wikiID := WikiIDFor(object(arguments["repo_config"]), branch)
	repository := strings.ReplaceAll(wikiID[:strings.LastIndex(wikiID, "--")], "--", "/")
	pageKeys := []string{
		"wiki_pages/overview/getting-started.md",
		"wiki_pages/architecture/request-flow.md",
		"wiki_pages/components/storage.md",
	}
	pages := map[string]string{
		pageKeys[0]: fmt.Sprintf("# Getting started\n\nGenerated by the fixture runner for `%s` in answer to: %s\n", repository, query),
		pageKeys[1]: BrokenMermaidPage,
		pageKeys[2]: "# Storage\n\nObjects live in the `wiki-artifacts` bucket, one key per page.\n",
	}
	title := repository[strings.LastIndex(repository, "/")+1:] + " wiki"
	manifest, _ := json.MarshalIndent(map[string]any{
		"schema_version":            1,
		"wiki_id":                   wikiID,
		"wiki_title":                title,
		"description":               "Generated by the DeepWiki fixture runner.",
		"wiki_version_id":           "fixture-1",
		"created_at":                "2026-01-01T00:00:00Z",
		"canonical_repo_identifier": repository,
		"repository":                repository,
		"branch":                    branch,
		"provider_type":             "github",
		"pages":                     pageKeys,
	}, "", "  ")
	structure, _ := json.MarshalIndent(map[string]any{
		"title": title,
		"sections": []map[string]any{
			{"title": "Overview", "pages": []string{pageKeys[0]}},
			{"title": "Architecture", "pages": []string{pageKeys[1]}},
			{"title": "Components", "pages": []string{pageKeys[2]}},
		},
	}, "", "  ")
	artifacts := []any{
		map[string]any{"name": wikiID + "/analysis/wiki_structure_fixture.json", "type": "application/json", "data": string(structure)},
	}
	for _, key := range pageKeys {
		artifacts = append(artifacts, map[string]any{"name": wikiID + "/" + key, "type": "text/markdown", "data": pages[key]})
	}
	artifacts = append(artifacts, map[string]any{"name": wikiID + "/wiki_manifest_fixture-1.json", "type": "application/json", "data": string(manifest)})
	return map[string]any{
		"success":            true,
		"result":             fmt.Sprintf("Wiki generated: %d pages", len(pageKeys)),
		"wiki_id":            wikiID,
		"artifacts":          artifacts,
		"repository_context": fmt.Sprintf("repository: %s\nbranch: %s\nfiles: 12\n", repository, branch),
	}
}

func fixtureAsk(arguments map[string]any) map[string]any {
	return map[string]any{
		"success": true,
		"answer":  "Fixture answer to: " + str(arguments["question"]),
		"sources": []any{
			map[string]any{"source": "wiki_pages/overview/getting-started.md"},
			map[string]any{"source": "wiki_pages/components/storage.md"},
		},
	}
}

func fixtureDeepResearch(arguments map[string]any) map[string]any {
	researchType := str(firstTruthy(arguments["research_type"], "general"))
	return map[string]any{
		"success": true,
		"report":  fmt.Sprintf("# Research report (%s)\n\nQuestion: %s\n\nFindings: fixture.\n", researchType, str(arguments["question"])),
	}
}

// NewFixtureRunner is the fixture table under the shared runner, pacing
// its progress by step, with the egress policy and the callback CA from
// the host's settings.
func NewFixtureRunner(settings spi.Settings, step time.Duration) *Runner {
	return &Runner{
		RunnerName: "fixture",
		Tools:      FixtureTools(step),
		Egress:     spi.ParseEgressPolicy(settings.GitAllowlist),
		Artifacts:  ArtifactClientFrom(settings.TLSCAFile),
	}
}
