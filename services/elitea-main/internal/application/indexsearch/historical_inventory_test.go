package indexsearch

import (
	"errors"
	"testing"

	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
)

func TestHistoricalEmbeddingInventoryRequiresExactImmutableEvidenceOrApprovedReindex(t *testing.T) {
	exact := exactHistoricalEvidence()
	legacy := exact
	legacy.IndexName = "legacy"
	legacy.IndexGeneration = 1
	legacy.SourceMetadataDigest = runtimedomain.SHA256([]byte("legacy-source"))
	legacy.ExecutionMatches = 0
	legacy.BindingEntryMatches = 0
	legacy.Recorded = nil

	report, err := BuildHistoricalEmbeddingInventory(HistoricalEmbeddingInventoryInput{
		ResourceProjectID: "7",
		ToolkitID:         19,
		CoverageComplete:  true,
		Evidence:          []HistoricalEmbeddingEvidence{legacy, exact},
	})
	if err != nil {
		t.Fatal(err)
	}
	if report.ExactEvidence != 1 || report.ReindexRequired != 1 ||
		report.UnapprovedReindex != 1 || report.Unresolved != 0 ||
		!errors.Is(report.RequireMountReady(), ErrHistoricalEmbeddingInventoryBlocked) {
		t.Fatalf("unapproved report=%+v", report)
	}

	report, err = BuildHistoricalEmbeddingInventory(HistoricalEmbeddingInventoryInput{
		ResourceProjectID: "7",
		ToolkitID:         19,
		CoverageComplete:  true,
		Evidence:          []HistoricalEmbeddingEvidence{legacy, exact},
		ReindexApprovals: []HistoricalReindexApproval{{
			ResourceProjectID:    legacy.ResourceProjectID,
			ToolkitID:            legacy.ToolkitID,
			IndexName:            legacy.IndexName,
			IndexGeneration:      legacy.IndexGeneration,
			SourceMetadataDigest: legacy.SourceMetadataDigest,
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if report.ApprovedReindex != 1 || report.UnapprovedReindex != 0 ||
		!errors.Is(report.RequireMountReady(), ErrHistoricalEmbeddingInventoryBlocked) {
		t.Fatalf("approved report=%+v", report)
	}
	backfill, err := ExactHistoricalEmbeddingBackfill(exact)
	if err != nil || backfill.Recorded.Binding.ModelName != "embed" ||
		backfill.Input.EntryID != "embedding-binding" {
		t.Fatalf("exact backfill=%+v err=%v", backfill, err)
	}
	if _, err := ExactHistoricalEmbeddingBackfill(legacy); !errors.Is(
		err,
		ErrHistoricalEmbeddingReindexRequired,
	) {
		t.Fatalf("legacy backfill error=%v", err)
	}
	exactReport, err := BuildHistoricalEmbeddingInventory(HistoricalEmbeddingInventoryInput{
		ResourceProjectID: "7",
		ToolkitID:         19,
		CoverageComplete:  true,
		Evidence:          []HistoricalEmbeddingEvidence{exact},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := exactReport.RequireOperation(SearchIndex, "7", 19, "docs"); err != nil {
		t.Fatal(err)
	}
	if err := exactReport.RequireOperation(SearchIndex, "7", 19, "missing"); !errors.Is(
		err,
		ErrHistoricalEmbeddingInventoryBlocked,
	) {
		t.Fatalf("missing target error=%v", err)
	}
	for _, operation := range []Operation{ListIndexes, SearchIndex, StepbackSearchIndex} {
		if err := exactReport.RequireOperation(operation, "7", 19, ""); err != nil {
			t.Fatalf("global operation %s error=%v", operation, err)
		}
	}
}

func TestHistoricalEmbeddingInventoryFailsClosedOnIncompleteOrInvalidEvidence(t *testing.T) {
	incomplete, err := BuildHistoricalEmbeddingInventory(
		HistoricalEmbeddingInventoryInput{
			ResourceProjectID: "7",
			ToolkitID:         19,
			CoverageComplete:  false,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if incomplete.Unresolved != 1 ||
		!errors.Is(incomplete.RequireMountReady(), ErrHistoricalEmbeddingInventoryBlocked) {
		t.Fatalf("incomplete report=%+v", incomplete)
	}

	invalid := exactHistoricalEvidence()
	invalid.SourceMetadataDigest = runtimedomain.Digest{}
	report, err := BuildHistoricalEmbeddingInventory(HistoricalEmbeddingInventoryInput{
		ResourceProjectID: "7",
		ToolkitID:         19,
		CoverageComplete:  true,
		Evidence:          []HistoricalEmbeddingEvidence{invalid},
	})
	if err != nil {
		t.Fatal(err)
	}
	if report.Unresolved != 1 || report.Items[0].Disposition != HistoricalEmbeddingUnresolved ||
		report.Items[0].Reason != HistoricalEmbeddingReasonSourceEvidenceInvalid {
		t.Fatalf("invalid report=%+v", report)
	}

	exact := exactHistoricalEvidence()
	if _, err := BuildHistoricalEmbeddingInventory(HistoricalEmbeddingInventoryInput{
		ResourceProjectID: "7",
		ToolkitID:         19,
		CoverageComplete:  true,
		Evidence:          []HistoricalEmbeddingEvidence{exact, exact},
	}); !errors.Is(err, ErrInvalidHistoricalEmbeddingInventory) {
		t.Fatalf("duplicate evidence error=%v", err)
	}
}

func TestHistoricalEmbeddingInventoryNeverSynthesizesFromCurrentState(t *testing.T) {
	evidence := exactHistoricalEvidence()
	evidence.Recorded = nil
	report, err := BuildHistoricalEmbeddingInventory(HistoricalEmbeddingInventoryInput{
		ResourceProjectID: "7",
		ToolkitID:         19,
		CoverageComplete:  true,
		Evidence:          []HistoricalEmbeddingEvidence{evidence},
	})
	if err != nil {
		t.Fatal(err)
	}
	if report.ReindexRequired != 1 ||
		report.Items[0].Reason != HistoricalEmbeddingReasonBindingInvalid ||
		report.ExactEvidence != 0 {
		t.Fatalf("missing immutable binding was synthesized: %+v", report)
	}
}

func exactHistoricalEvidence() HistoricalEmbeddingEvidence {
	configurationDigest := runtimedomain.SHA256([]byte("configuration"))
	binding := indexingapp.EmbeddingBinding{
		SchemaVersion:          indexingapp.CurrentEmbeddingBindingSchema,
		ModelName:              "embed",
		ResolvedModelGroup:     "7_embed",
		Route:                  "project",
		ModelProjectID:         7,
		ConfigurationProjectID: 7,
		ConfigurationUUID:      "00000000-0000-0000-0000-000000000701",
		ConfigurationDigest:    configurationDigest,
	}
	return HistoricalEmbeddingEvidence{
		ResourceProjectID:    "7",
		ToolkitID:            19,
		IndexName:            "docs",
		IndexGeneration:      4,
		SourceMetadataDigest: runtimedomain.SHA256([]byte("metadata")),
		DeclaredModelName:    "embed",
		MetadataMatches:      1,
		ExecutionMatches:     1,
		BindingEntryMatches:  1,
		Recorded: &RecordedEmbeddingBinding{
			ResourceProjectID: "7",
			ToolkitID:         19,
			IndexName:         "docs",
			IndexGeneration:   4,
			Input: InputBinding{
				EntryID: "embedding-binding",
				Version: "sha256:embedding-binding",
				Digest:  runtimedomain.SHA256([]byte("binding")),
			},
			Binding: binding,
		},
	}
}
