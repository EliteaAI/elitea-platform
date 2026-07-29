package indexsearch

import (
	"errors"
	"fmt"
	"sort"

	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
)

const MaxHistoricalEmbeddingInventoryEntries = 10_000

var (
	ErrInvalidHistoricalEmbeddingInventory = errors.New("invalid historical embedding inventory")
	ErrHistoricalEmbeddingInventoryBlocked = errors.New("historical embedding inventory blocks index search")
	ErrHistoricalEmbeddingReindexRequired  = errors.New("historical index generation requires reindex")
)

type HistoricalEmbeddingDisposition string

const (
	HistoricalEmbeddingExactImmutableEvidence HistoricalEmbeddingDisposition = "EXACT_IMMUTABLE_EVIDENCE"
	HistoricalEmbeddingReindexRequired        HistoricalEmbeddingDisposition = "REINDEX_REQUIRED"
	HistoricalEmbeddingUnresolved             HistoricalEmbeddingDisposition = "UNRESOLVED"
)

type HistoricalEmbeddingReason string

const (
	HistoricalEmbeddingReasonExact                 HistoricalEmbeddingReason = "EXACT_JOB_AND_BINDING_ENTRY"
	HistoricalEmbeddingReasonMetadataMissing       HistoricalEmbeddingReason = "INDEX_METADATA_MISSING"
	HistoricalEmbeddingReasonMetadataAmbiguous     HistoricalEmbeddingReason = "INDEX_METADATA_AMBIGUOUS"
	HistoricalEmbeddingReasonModelMissing          HistoricalEmbeddingReason = "HISTORICAL_MODEL_MISSING"
	HistoricalEmbeddingReasonExecutionMissing      HistoricalEmbeddingReason = "EXECUTION_LINKAGE_MISSING"
	HistoricalEmbeddingReasonExecutionAmbiguous    HistoricalEmbeddingReason = "EXECUTION_LINKAGE_AMBIGUOUS"
	HistoricalEmbeddingReasonBindingMissing        HistoricalEmbeddingReason = "BINDING_ENTRY_MISSING"
	HistoricalEmbeddingReasonBindingAmbiguous      HistoricalEmbeddingReason = "BINDING_ENTRY_AMBIGUOUS"
	HistoricalEmbeddingReasonBindingInvalid        HistoricalEmbeddingReason = "BINDING_ENTRY_INVALID"
	HistoricalEmbeddingReasonSourceEvidenceInvalid HistoricalEmbeddingReason = "SOURCE_EVIDENCE_INVALID"
)

// HistoricalEmbeddingEvidence is a safe projection of one concrete collection
// generation. The caller must enumerate collections from every vector row, not
// only index_meta rows. Recorded may be populated only from an exact central
// execution_jobs/index_ingest_jobs/input_bundle_entries join; current
// Configurations or LiteLLM state is not historical evidence.
type HistoricalEmbeddingEvidence struct {
	ResourceProjectID    string
	ToolkitID            int32
	IndexName            string
	IndexGeneration      uint64
	SourceMetadataDigest runtimedomain.Digest
	DeclaredModelName    string
	MetadataMatches      int
	ExecutionMatches     int
	BindingEntryMatches  int
	Recorded             *RecordedEmbeddingBinding
}

type HistoricalReindexApproval struct {
	ResourceProjectID    string
	ToolkitID            int32
	IndexName            string
	IndexGeneration      uint64
	SourceMetadataDigest runtimedomain.Digest
}

type HistoricalEmbeddingInventoryInput struct {
	ResourceProjectID string
	ToolkitID         int32
	CoverageComplete  bool
	Evidence          []HistoricalEmbeddingEvidence
	ReindexApprovals  []HistoricalReindexApproval
}

type HistoricalEmbeddingInventoryItem struct {
	ResourceProjectID    string                         `json:"resource_project_id"`
	ToolkitID            int32                          `json:"toolkit_id"`
	IndexName            string                         `json:"index_name"`
	IndexGeneration      uint64                         `json:"index_generation"`
	SourceMetadataDigest string                         `json:"source_metadata_digest"`
	Disposition          HistoricalEmbeddingDisposition `json:"disposition"`
	Reason               HistoricalEmbeddingReason      `json:"reason"`
	ReindexApproved      bool                           `json:"reindex_approved"`
}

type HistoricalEmbeddingInventoryReport struct {
	ResourceProjectID string                             `json:"resource_project_id"`
	ToolkitID         int32                              `json:"toolkit_id"`
	CoverageComplete  bool                               `json:"coverage_complete"`
	Items             []HistoricalEmbeddingInventoryItem `json:"items"`
	ExactEvidence     int                                `json:"exact_immutable_evidence"`
	ReindexRequired   int                                `json:"reindex_required"`
	ApprovedReindex   int                                `json:"approved_reindex"`
	UnapprovedReindex int                                `json:"unapproved_reindex"`
	Unresolved        int                                `json:"unresolved"`
}

// HistoricalEmbeddingBackfill is reference-only. It may be written to a
// future association store without changing the immutable input bundle or
// inventing model/configuration content.
type HistoricalEmbeddingBackfill struct {
	ResourceProjectID    string
	ToolkitID            int32
	IndexName            string
	IndexGeneration      uint64
	SourceMetadataDigest runtimedomain.Digest
	Input                InputBinding
	Recorded             RecordedEmbeddingBinding
}

func BuildHistoricalEmbeddingInventory(
	input HistoricalEmbeddingInventoryInput,
) (HistoricalEmbeddingInventoryReport, error) {
	if !validIdentity(input.ResourceProjectID) ||
		input.ToolkitID <= 0 ||
		len(input.Evidence) > MaxHistoricalEmbeddingInventoryEntries ||
		len(input.ReindexApprovals) > MaxHistoricalEmbeddingInventoryEntries {
		return HistoricalEmbeddingInventoryReport{}, ErrInvalidHistoricalEmbeddingInventory
	}
	approvals := make(map[string]HistoricalReindexApproval, len(input.ReindexApprovals))
	for _, approval := range input.ReindexApprovals {
		if approval.ResourceProjectID != input.ResourceProjectID ||
			approval.ToolkitID != input.ToolkitID {
			return HistoricalEmbeddingInventoryReport{}, ErrInvalidHistoricalEmbeddingInventory
		}
		key, ok := historicalApprovalKey(approval)
		if !ok {
			return HistoricalEmbeddingInventoryReport{}, ErrInvalidHistoricalEmbeddingInventory
		}
		if _, duplicate := approvals[key]; duplicate {
			return HistoricalEmbeddingInventoryReport{}, ErrInvalidHistoricalEmbeddingInventory
		}
		approvals[key] = approval
	}

	report := HistoricalEmbeddingInventoryReport{
		ResourceProjectID: input.ResourceProjectID,
		ToolkitID:         input.ToolkitID,
		CoverageComplete:  input.CoverageComplete,
		Items:             make([]HistoricalEmbeddingInventoryItem, 0, len(input.Evidence)),
	}
	if !input.CoverageComplete {
		report.Unresolved++
	}
	seen := make(map[string]struct{}, len(input.Evidence))
	for _, evidence := range input.Evidence {
		if evidence.ResourceProjectID != input.ResourceProjectID ||
			evidence.ToolkitID != input.ToolkitID {
			return HistoricalEmbeddingInventoryReport{}, ErrInvalidHistoricalEmbeddingInventory
		}
		item, key := classifyHistoricalEmbeddingEvidence(evidence)
		if key == "" {
			item.Disposition = HistoricalEmbeddingUnresolved
			item.Reason = HistoricalEmbeddingReasonSourceEvidenceInvalid
			report.Unresolved++
			report.Items = append(report.Items, item)
			continue
		}
		if _, duplicate := seen[key]; duplicate {
			return HistoricalEmbeddingInventoryReport{}, ErrInvalidHistoricalEmbeddingInventory
		}
		seen[key] = struct{}{}
		approval, approved := approvals[key]
		switch item.Disposition {
		case HistoricalEmbeddingExactImmutableEvidence:
			if approved {
				return HistoricalEmbeddingInventoryReport{}, ErrInvalidHistoricalEmbeddingInventory
			}
			report.ExactEvidence++
		case HistoricalEmbeddingReindexRequired:
			report.ReindexRequired++
			if approved && approval.SourceMetadataDigest == evidence.SourceMetadataDigest {
				item.ReindexApproved = true
				report.ApprovedReindex++
			} else {
				report.UnapprovedReindex++
			}
		case HistoricalEmbeddingUnresolved:
			if approved {
				return HistoricalEmbeddingInventoryReport{}, ErrInvalidHistoricalEmbeddingInventory
			}
			report.Unresolved++
		default:
			return HistoricalEmbeddingInventoryReport{}, ErrInvalidHistoricalEmbeddingInventory
		}
		delete(approvals, key)
		report.Items = append(report.Items, item)
	}
	if len(approvals) != 0 {
		return HistoricalEmbeddingInventoryReport{}, ErrInvalidHistoricalEmbeddingInventory
	}
	sort.Slice(report.Items, func(left, right int) bool {
		return historicalInventoryItemKey(report.Items[left]) <
			historicalInventoryItemKey(report.Items[right])
	})
	return report, nil
}

func (r HistoricalEmbeddingInventoryReport) RequireMountReady() error {
	if !r.CoverageComplete || r.Unresolved != 0 || r.ReindexRequired != 0 {
		return fmt.Errorf(
			"%w: coverage_complete=%t unresolved=%d reindex_required=%d",
			ErrHistoricalEmbeddingInventoryBlocked,
			r.CoverageComplete,
			r.Unresolved,
			r.ReindexRequired,
		)
	}
	return nil
}

func ExactHistoricalEmbeddingBackfill(
	evidence HistoricalEmbeddingEvidence,
) (HistoricalEmbeddingBackfill, error) {
	item, key := classifyHistoricalEmbeddingEvidence(evidence)
	if key == "" {
		return HistoricalEmbeddingBackfill{}, ErrInvalidHistoricalEmbeddingInventory
	}
	if item.Disposition != HistoricalEmbeddingExactImmutableEvidence ||
		evidence.Recorded == nil {
		return HistoricalEmbeddingBackfill{}, ErrHistoricalEmbeddingReindexRequired
	}
	recorded := *evidence.Recorded
	recorded.Binding = evidence.Recorded.Binding.Clone()
	return HistoricalEmbeddingBackfill{
		ResourceProjectID:    evidence.ResourceProjectID,
		ToolkitID:            evidence.ToolkitID,
		IndexName:            evidence.IndexName,
		IndexGeneration:      evidence.IndexGeneration,
		SourceMetadataDigest: evidence.SourceMetadataDigest,
		Input:                evidence.Recorded.Input,
		Recorded:             recorded,
	}, nil
}

func (r HistoricalEmbeddingInventoryReport) RequireOperation(
	operation Operation,
	resourceProjectID string,
	toolkitID int32,
	indexName string,
) error {
	if err := r.RequireMountReady(); err != nil {
		return err
	}
	if !validIdentity(resourceProjectID) || toolkitID <= 0 {
		return ErrInvalidHistoricalEmbeddingInventory
	}
	if resourceProjectID != r.ResourceProjectID || toolkitID != r.ToolkitID {
		return fmt.Errorf("%w: requested scope is absent", ErrHistoricalEmbeddingInventoryBlocked)
	}
	switch operation {
	case ListIndexes:
		return nil
	case SearchIndex, StepbackSearchIndex:
		if indexName == "" {
			return nil
		}
	default:
		return ErrInvalidHistoricalEmbeddingInventory
	}
	for _, item := range r.Items {
		if item.ResourceProjectID == resourceProjectID &&
			item.ToolkitID == toolkitID &&
			item.IndexName == indexName {
			return nil
		}
	}
	return fmt.Errorf("%w: requested collection is absent", ErrHistoricalEmbeddingInventoryBlocked)
}

func classifyHistoricalEmbeddingEvidence(
	evidence HistoricalEmbeddingEvidence,
) (HistoricalEmbeddingInventoryItem, string) {
	item := HistoricalEmbeddingInventoryItem{
		ResourceProjectID:    evidence.ResourceProjectID,
		ToolkitID:            evidence.ToolkitID,
		IndexName:            evidence.IndexName,
		IndexGeneration:      evidence.IndexGeneration,
		SourceMetadataDigest: evidence.SourceMetadataDigest.String(),
	}
	key, validIdentity := historicalEvidenceKey(evidence)
	if !validIdentity ||
		evidence.MetadataMatches < 0 ||
		evidence.ExecutionMatches < 0 ||
		evidence.BindingEntryMatches < 0 {
		item.Disposition = HistoricalEmbeddingUnresolved
		item.Reason = HistoricalEmbeddingReasonSourceEvidenceInvalid
		return item, ""
	}
	switch {
	case evidence.MetadataMatches == 0:
		item.Disposition = HistoricalEmbeddingReindexRequired
		item.Reason = HistoricalEmbeddingReasonMetadataMissing
	case evidence.MetadataMatches != 1:
		item.Disposition = HistoricalEmbeddingReindexRequired
		item.Reason = HistoricalEmbeddingReasonMetadataAmbiguous
	case evidence.DeclaredModelName == "":
		item.Disposition = HistoricalEmbeddingReindexRequired
		item.Reason = HistoricalEmbeddingReasonModelMissing
	case evidence.ExecutionMatches == 0:
		item.Disposition = HistoricalEmbeddingReindexRequired
		item.Reason = HistoricalEmbeddingReasonExecutionMissing
	case evidence.ExecutionMatches != 1:
		item.Disposition = HistoricalEmbeddingReindexRequired
		item.Reason = HistoricalEmbeddingReasonExecutionAmbiguous
	case evidence.BindingEntryMatches == 0:
		item.Disposition = HistoricalEmbeddingReindexRequired
		item.Reason = HistoricalEmbeddingReasonBindingMissing
	case evidence.BindingEntryMatches != 1:
		item.Disposition = HistoricalEmbeddingReindexRequired
		item.Reason = HistoricalEmbeddingReasonBindingAmbiguous
	case !historicalRecordedBindingMatches(evidence):
		item.Disposition = HistoricalEmbeddingReindexRequired
		item.Reason = HistoricalEmbeddingReasonBindingInvalid
	default:
		item.Disposition = HistoricalEmbeddingExactImmutableEvidence
		item.Reason = HistoricalEmbeddingReasonExact
	}
	return item, key
}

func historicalRecordedBindingMatches(evidence HistoricalEmbeddingEvidence) bool {
	if evidence.Recorded == nil {
		return false
	}
	binding := evidence.Recorded.Binding
	return RequireRecordedEmbeddingBinding(
		evidence.Recorded,
		EmbeddingExpectation{
			ResourceProjectID:   evidence.ResourceProjectID,
			ToolkitID:           evidence.ToolkitID,
			IndexName:           evidence.IndexName,
			IndexGeneration:     evidence.IndexGeneration,
			ModelName:           evidence.DeclaredModelName,
			ModelProjectID:      binding.ModelProjectID,
			ConfigurationUUID:   binding.ConfigurationUUID,
			ConfigurationDigest: binding.ConfigurationDigest,
		},
	) == nil
}

func historicalEvidenceKey(evidence HistoricalEmbeddingEvidence) (string, bool) {
	if !validIdentity(evidence.ResourceProjectID) ||
		evidence.ToolkitID <= 0 ||
		!validIdentity(evidence.IndexName) ||
		evidence.SourceMetadataDigest.IsZero() {
		return "", false
	}
	return fmt.Sprintf(
		"%s\x00%d\x00%s\x00%d",
		evidence.ResourceProjectID,
		evidence.ToolkitID,
		evidence.IndexName,
		evidence.IndexGeneration,
	), true
}

func historicalApprovalKey(approval HistoricalReindexApproval) (string, bool) {
	return historicalEvidenceKey(HistoricalEmbeddingEvidence{
		ResourceProjectID:    approval.ResourceProjectID,
		ToolkitID:            approval.ToolkitID,
		IndexName:            approval.IndexName,
		IndexGeneration:      approval.IndexGeneration,
		SourceMetadataDigest: approval.SourceMetadataDigest,
	})
}

func historicalInventoryItemKey(item HistoricalEmbeddingInventoryItem) string {
	return fmt.Sprintf(
		"%s\x00%010d\x00%s\x00%020d",
		item.ResourceProjectID,
		item.ToolkitID,
		item.IndexName,
		item.IndexGeneration,
	)
}
