package repos

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"

	agentexecutionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/agentexecution"
	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	outputapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/output"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/tenant"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AgentExecutionJobsRepository persists only execution durability and current
// browser correlation. Conversation content and trace steps remain owned by
// the existing per-project chat schema.
type AgentExecutionJobsRepository struct {
	pool   *pgxpool.Pool
	policy AgentExecutionDispatchPolicy
}

func (r *AgentExecutionJobsRepository) ExpectedAgentExecution(
	ctx context.Context,
	executionID string,
	generation uint64,
) (outputapp.ExpectedAgentExecution, error) {
	if executionID == "" || generation == 0 || generation > math.MaxInt64 {
		return outputapp.ExpectedAgentExecution{}, outputapp.ErrInvalidAgentExecutionOutput
	}
	row, err := sqlcgen.New(r.pool).GetExpectedAgentExecutionHeader(
		ctx,
		sqlcgen.GetExpectedAgentExecutionHeaderParams{
			ExecutionID: executionID,
			Generation:  int64(generation),
		},
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return outputapp.ExpectedAgentExecution{}, outputapp.ErrInvalidAgentExecutionOutput
	}
	if err != nil {
		return outputapp.ExpectedAgentExecution{}, fmt.Errorf("load agent output binding: %w", err)
	}
	if row.LimitsRevision != r.policy.LimitsRevision || row.Generation <= 0 ||
		row.ResourceProjectID <= 0 || row.ProjectionProjectID <= 0 {
		return outputapp.ExpectedAgentExecution{}, outputapp.ErrInvalidAgentExecutionOutput
	}
	bundleDigest, err := storedDigest(row.InputBundleDigest)
	if err != nil {
		return outputapp.ExpectedAgentExecution{}, fmt.Errorf("stored agent input bundle digest: %w", err)
	}
	requestDigest, err := storedDigest(row.RequestContentDigest)
	if err != nil {
		return outputapp.ExpectedAgentExecution{}, fmt.Errorf("stored agent request digest: %w", err)
	}
	expected := outputapp.ExpectedAgentExecution{
		TenantID:                  row.TenantID,
		ResourceProjectID:         strconv.FormatInt(int64(row.ResourceProjectID), 10),
		ProjectionProjectID:       strconv.FormatInt(int64(row.ProjectionProjectID), 10),
		CapabilityID:              row.CapabilityID,
		CommandID:                 row.CommandID,
		ExecutionID:               row.ExecutionID,
		Generation:                uint64(row.Generation),
		LogicalOutputID:           "agent-execution:" + row.ExecutionID,
		InputBundleID:             row.InputBundleID,
		InputBundleDigest:         bundleDigest,
		RequestEntryID:            row.RequestEntryID,
		RequestImmutableVersion:   row.RequestImmutableVersion,
		RequestContentDigest:      requestDigest,
		ClientStreamID:            row.ClientStreamID,
		ClientMessageID:           row.ClientMessageID,
		ClientExecutionGeneration: row.ClientExecutionGeneration,
		SIOEvent:                  row.SioEvent,
	}
	if err := expected.Validate(); err != nil {
		return outputapp.ExpectedAgentExecution{}, fmt.Errorf("invalid stored agent output binding: %w", err)
	}
	return expected, nil
}

func NewAgentExecutionJobsRepository(
	pool *pgxpool.Pool,
	policy AgentExecutionDispatchPolicy,
) (*AgentExecutionJobsRepository, error) {
	if pool == nil {
		return nil, errors.New("agent admission database is required")
	}
	if err := policy.validate(); err != nil {
		return nil, err
	}
	return &AgentExecutionJobsRepository{pool: pool, policy: policy}, nil
}

func (r *AgentExecutionJobsRepository) AdmitAgentExecution(
	ctx context.Context,
	admission agentexecutionapp.Admission,
) (executionapp.AdmissionOutcome, error) {
	if err := admission.Record.Validate(); err != nil {
		return executionapp.AdmissionOutcome{}, err
	}
	if !agentExecutionCapability(admission.Record.Job.CapabilityID) {
		return executionapp.AdmissionOutcome{}, executionapp.ErrInvalidAdmission
	}
	if err := admission.Binding.Validate(admission.Record.InputBundle); err != nil {
		return executionapp.AdmissionOutcome{}, err
	}
	if err := validateInputManifest(admission.Record.InputBundle); err != nil {
		return executionapp.AdmissionOutcome{}, err
	}
	if len(admission.Record.InputBundle.Manifest) > maxStoredInputManifestBytes ||
		len(admission.Record.InputBundle.Entries) != 1 ||
		len(admission.Record.InputBundle.Entries[0].Content) > executiondomain.MaxAgentExecutionInputBytes ||
		!boundedAgentAdmissionStrings(admission) ||
		admission.Record.Job.Generation > math.MaxInt64 ||
		admission.Record.Outbox.Generation > math.MaxInt64 {
		return executionapp.AdmissionOutcome{}, executionapp.ErrInvalidAdmission
	}
	if admission.CurrentTurn != nil {
		turn := admission.CurrentTurn
		if admission.CurrentAdhocTurn != nil ||
			admission.CurrentRegenerateTurn != nil ||
			admission.Record.Job.CapabilityID != executiondomain.AgentApplicationCapability ||
			turn.Validate() != nil ||
			turn.ProjectID > math.MaxInt32 ||
			turn.TargetParticipantID > math.MaxInt32 ||
			turn.ApplicationID > math.MaxInt32 || turn.ApplicationVersionID > math.MaxInt32 ||
			turn.ProjectID != resourceProjectIDUnchecked(admission.Record.Job.ResourceProjectID) ||
			turn.ResponseMessageID != admission.Binding.ClientMessageID ||
			turn.ConversationUUID != admission.Binding.ClientStreamID {
			return executionapp.AdmissionOutcome{}, executionapp.ErrInvalidAdmission
		}
	}
	if admission.CurrentAdhocTurn != nil {
		turn := admission.CurrentAdhocTurn
		if admission.CurrentRegenerateTurn != nil ||
			admission.Record.Job.CapabilityID != executiondomain.AgentAdhocCapability ||
			turn.Validate() != nil || turn.ProjectID > math.MaxInt32 ||
			turn.TargetParticipantID > math.MaxInt32 ||
			turn.ProjectID != resourceProjectIDUnchecked(admission.Record.Job.ResourceProjectID) ||
			turn.ResponseMessageID != admission.Binding.ClientMessageID ||
			turn.ConversationUUID != admission.Binding.ClientStreamID {
			return executionapp.AdmissionOutcome{}, executionapp.ErrInvalidAdmission
		}
	}
	if admission.CurrentRegenerateTurn != nil {
		turn := admission.CurrentRegenerateTurn
		if turn.Validate() != nil || turn.ProjectID > math.MaxInt32 ||
			turn.TargetParticipantID > math.MaxInt32 ||
			turn.ApplicationID > math.MaxInt32 || turn.ApplicationVersionID > math.MaxInt32 ||
			turn.ProjectID != resourceProjectIDUnchecked(admission.Record.Job.ResourceProjectID) ||
			turn.ResponseMessageID != admission.Binding.ClientMessageID ||
			turn.ConversationUUID != admission.Binding.ClientStreamID ||
			turn.ExecutionGeneration != admission.Binding.ClientExecutionGeneration ||
			(turn.Kind == agentexecutionapp.CurrentRegenerationApplication && admission.Record.Job.CapabilityID != executiondomain.AgentApplicationCapability) ||
			(turn.Kind == agentexecutionapp.CurrentRegenerationAdhoc && admission.Record.Job.CapabilityID != executiondomain.AgentAdhocCapability) {
			return executionapp.AdmissionOutcome{}, executionapp.ErrInvalidAdmission
		}
	}

	resourceProject, err := parseProjectID(admission.Record.Job.ResourceProjectID)
	if err != nil || resourceProject > math.MaxInt32 {
		return executionapp.AdmissionOutcome{}, fmt.Errorf(
			"resource project: %w",
			errors.New("project ID must fit the current integer schema"),
		)
	}
	projectionProject, err := parseProjectID(admission.Record.Job.ProjectionProjectID)
	if err != nil || projectionProject > math.MaxInt32 {
		return executionapp.AdmissionOutcome{}, fmt.Errorf(
			"projection project: %w",
			errors.New("project ID must fit the current integer schema"),
		)
	}

	queries := sqlcgen.New(r.pool)
	existing, digest, err := loadAgentAdmission(
		ctx,
		queries,
		admission.Record.IdempotencyScope,
		admission.Record.IdempotencyKey,
	)
	switch {
	case err == nil:
		if digest != admission.Record.RequestDigest {
			return executionapp.AdmissionOutcome{}, executionapp.ErrIdempotencyConflict
		}
		return existing, nil
	case !errors.Is(err, pgx.ErrNoRows):
		return executionapp.AdmissionOutcome{}, fmt.Errorf("load agent idempotency binding: %w", err)
	}

	tx, err := r.pool.BeginTx(
		ctx,
		pgx.TxOptions{IsoLevel: pgx.ReadCommitted, AccessMode: pgx.ReadWrite},
	)
	if err != nil {
		return executionapp.AdmissionOutcome{}, fmt.Errorf("begin agent admission transaction: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback(context.WithoutCancel(ctx))
		}
	}()
	txQueries := sqlcgen.New(tx)
	currentProjectID := int64(0)
	if admission.CurrentTurn != nil {
		currentProjectID = admission.CurrentTurn.ProjectID
	} else if admission.CurrentAdhocTurn != nil {
		currentProjectID = admission.CurrentAdhocTurn.ProjectID
	} else if admission.CurrentRegenerateTurn != nil {
		currentProjectID = admission.CurrentRegenerateTurn.ProjectID
	}
	if currentProjectID > 0 {
		if err := tenant.BindProject(
			ctx,
			tx,
			tenant.Project{ID: currentProjectID},
		); err != nil {
			return executionapp.AdmissionOutcome{}, fmt.Errorf("bind current agent project: %w", err)
		}
		conversationID := ""
		if admission.CurrentTurn != nil {
			conversationID = admission.CurrentTurn.ConversationUUID
		} else if admission.CurrentAdhocTurn != nil {
			conversationID = admission.CurrentAdhocTurn.ConversationUUID
		} else {
			conversationID = admission.CurrentRegenerateTurn.ConversationUUID
		}
		conversationUUID, err := currentPGUUID(conversationID)
		if err != nil {
			return executionapp.AdmissionOutcome{}, executionapp.ErrInvalidAdmission
		}
		if _, err := txQueries.LockCurrentAgentConversation(ctx, conversationUUID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return executionapp.AdmissionOutcome{}, agentexecutionapp.ErrUnsupportedCurrentAgentStart
			}
			return executionapp.AdmissionOutcome{}, fmt.Errorf("lock current agent conversation: %w", err)
		}
	}
	capabilityID := admission.Record.Job.CapabilityID
	if err := txQueries.EnsureRuntimeAdmissionPolicy(
		ctx,
		sqlcgen.EnsureRuntimeAdmissionPolicyParams{
			CapabilityID:   capabilityID,
			MaxOutstanding: r.policy.MaxOutstanding,
		},
	); err != nil {
		return executionapp.AdmissionOutcome{}, fmt.Errorf("ensure agent admission policy: %w", err)
	}
	persistedMax, err := txQueries.LockRuntimeAdmissionPolicy(ctx, capabilityID)
	if err != nil {
		return executionapp.AdmissionOutcome{}, fmt.Errorf("lock agent admission policy: %w", err)
	}
	if persistedMax != r.policy.MaxOutstanding {
		return executionapp.AdmissionOutcome{}, fmt.Errorf(
			"%w: capability %q configured=%d persisted=%d",
			ErrAdmissionPolicyMismatch,
			capabilityID,
			r.policy.MaxOutstanding,
			persistedMax,
		)
	}

	existing, digest, err = loadAgentAdmission(
		ctx,
		txQueries,
		admission.Record.IdempotencyScope,
		admission.Record.IdempotencyKey,
	)
	switch {
	case err == nil:
		if digest != admission.Record.RequestDigest {
			return executionapp.AdmissionOutcome{}, executionapp.ErrIdempotencyConflict
		}
		if err := tx.Commit(ctx); err != nil {
			return executionapp.AdmissionOutcome{}, fmt.Errorf("commit agent admission replay: %w", err)
		}
		committed = true
		return existing, nil
	case !errors.Is(err, pgx.ErrNoRows):
		return executionapp.AdmissionOutcome{}, fmt.Errorf("reload agent idempotency binding: %w", err)
	}

	active, err := txQueries.CountActiveRuntimeExecutionsUpTo(
		ctx,
		sqlcgen.CountActiveRuntimeExecutionsUpToParams{
			CapabilityID:   capabilityID,
			MaxOutstanding: r.policy.MaxOutstanding,
		},
	)
	if err != nil {
		return executionapp.AdmissionOutcome{}, fmt.Errorf("count active agent executions: %w", err)
	}
	if active >= r.policy.MaxOutstanding {
		if err := tx.Commit(ctx); err != nil {
			return executionapp.AdmissionOutcome{}, fmt.Errorf("commit agent capacity observation: %w", err)
		}
		committed = true
		return executionapp.AdmissionOutcome{}, &executionapp.AdmissionCapacityError{
			CapabilityID:   capabilityID,
			MaxOutstanding: r.policy.MaxOutstanding,
		}
	}

	timingRow, err := txQueries.LoadRuntimeAdmissionTiming(
		ctx,
		r.policy.DeadlineTTL.Milliseconds(),
	)
	if err != nil {
		return executionapp.AdmissionOutcome{}, fmt.Errorf("load agent admission timing: %w", err)
	}
	timing, err := decodeAdmissionTiming(timingRow, r.policy.DeadlineTTL)
	if err != nil {
		return executionapp.AdmissionOutcome{}, err
	}
	if err := insertRuntimeInputBundle(
		ctx,
		txQueries,
		int32(resourceProject),
		admission.Record,
		timing.AdmittedAt,
	); err != nil {
		return executionapp.AdmissionOutcome{}, err
	}
	createdID, err := txQueries.InsertAgentExecutionJob(
		ctx,
		sqlcgen.InsertAgentExecutionJobParams{
			ExecutionID:         admission.Record.Job.ID,
			Generation:          int64(admission.Record.Job.Generation),
			CommandID:           admission.Record.Job.CommandID,
			TenantID:            admission.Record.Job.TenantID,
			ResourceProjectID:   int32(resourceProject),
			ProjectionProjectID: int32(projectionProject),
			ActorID:             admission.Record.Job.ActorID,
			PrincipalRef:        admission.Record.Job.ActorID,
			CapabilityID:        capabilityID,
			CapabilityVersion:   r.policy.CapabilityVersion,
			InputBundleID:       admission.Record.InputBundle.ID,
			RequestDigest:       append([]byte(nil), admission.Record.RequestDigest[:]...),
			IdempotencyScope:    admission.Record.IdempotencyScope,
			IdempotencyKey:      admission.Record.IdempotencyKey,
			State:               string(admission.Record.Job.State),
			AdmittedAt:          timestamp(timing.AdmittedAt),
		},
	)
	if errors.Is(err, pgx.ErrNoRows) {
		existing, digest, loadErr := loadAgentAdmission(
			ctx,
			txQueries,
			admission.Record.IdempotencyScope,
			admission.Record.IdempotencyKey,
		)
		if loadErr != nil {
			return executionapp.AdmissionOutcome{}, fmt.Errorf("load concurrent agent admission: %w", loadErr)
		}
		if digest != admission.Record.RequestDigest {
			return executionapp.AdmissionOutcome{}, executionapp.ErrIdempotencyConflict
		}
		if rollbackErr := tx.Rollback(context.WithoutCancel(ctx)); rollbackErr != nil &&
			!errors.Is(rollbackErr, pgx.ErrTxClosed) {
			return executionapp.AdmissionOutcome{}, fmt.Errorf("rollback concurrent agent admission: %w", rollbackErr)
		}
		committed = true
		return existing, nil
	}
	if err != nil {
		return executionapp.AdmissionOutcome{}, fmt.Errorf("insert agent execution job: %w", err)
	}
	if createdID != admission.Record.Job.ID {
		return executionapp.AdmissionOutcome{}, errors.New("agent execution job insert changed identity")
	}
	if err := txQueries.InsertAgentExecutionBinding(
		ctx,
		sqlcgen.InsertAgentExecutionBindingParams{
			ExecutionID:               admission.Record.Job.ID,
			Generation:                int64(admission.Record.Job.Generation),
			CapabilityID:              capabilityID,
			InputBundleID:             admission.Record.InputBundle.ID,
			RequestEntryID:            admission.Binding.RequestEntryID,
			ClientStreamID:            admission.Binding.ClientStreamID,
			ClientMessageID:           admission.Binding.ClientMessageID,
			ClientExecutionGeneration: admission.Binding.ClientExecutionGeneration,
			SioEvent:                  admission.Binding.SIOEvent,
		},
	); err != nil {
		return executionapp.AdmissionOutcome{}, fmt.Errorf("insert agent execution binding: %w", err)
	}
	if admission.CurrentTurn != nil {
		if err := insertCurrentApplicationTurn(
			ctx,
			txQueries,
			admission.Record.Job.ID,
			*admission.CurrentTurn,
		); err != nil {
			return executionapp.AdmissionOutcome{}, err
		}
	} else if admission.CurrentAdhocTurn != nil {
		if err := insertCurrentAdhocTurn(
			ctx,
			txQueries,
			admission.Record.Job.ID,
			*admission.CurrentAdhocTurn,
		); err != nil {
			return executionapp.AdmissionOutcome{}, err
		}
	} else if admission.CurrentRegenerateTurn != nil {
		if err := resetCurrentAgentResponse(
			ctx,
			txQueries,
			admission.Record.Job.ID,
			*admission.CurrentRegenerateTurn,
		); err != nil {
			return executionapp.AdmissionOutcome{}, err
		}
	}
	if err := txQueries.InsertRuntimeCommandOutbox(
		ctx,
		sqlcgen.InsertRuntimeCommandOutboxParams{
			OutboxID:       admission.Record.Outbox.ID,
			ExecutionID:    admission.Record.Outbox.ExecutionID,
			Generation:     int64(admission.Record.Outbox.Generation),
			StreamName:     r.policy.StreamName,
			ResourceClass:  r.policy.ResourceClass,
			IsolationClass: r.policy.IsolationClass,
			Priority:       int32(r.policy.Priority),
			Deadline:       timestamp(timing.Deadline),
			LimitsRevision: r.policy.LimitsRevision,
			CreatedAt:      timestamp(timing.AdmittedAt),
		},
	); err != nil {
		return executionapp.AdmissionOutcome{}, fmt.Errorf("insert agent command outbox: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return executionapp.AdmissionOutcome{}, fmt.Errorf("commit agent admission: %w", err)
	}
	committed = true
	return executionapp.AdmissionOutcome{
		ExecutionID: admission.Record.Job.ID,
		CommandID:   admission.Record.Job.CommandID,
		Created:     true,
		AdmittedAt:  timing.AdmittedAt,
		Deadline:    timing.Deadline,
	}, nil
}

func resetCurrentAgentResponse(
	ctx context.Context,
	queries *sqlcgen.Queries,
	executionID string,
	turn agentexecutionapp.CurrentRegenerateTurn,
) error {
	conversationUUID, err := currentPGUUID(turn.ConversationUUID)
	if err != nil {
		return executionapp.ErrInvalidAdmission
	}
	questionID, err := currentPGUUID(turn.QuestionID)
	if err != nil {
		return executionapp.ErrInvalidAdmission
	}
	responseMessageID, err := currentPGUUID(turn.ResponseMessageID)
	if err != nil {
		return executionapp.ErrInvalidAdmission
	}
	row, err := queries.ResetCurrentAgentResponse(
		ctx,
		sqlcgen.ResetCurrentAgentResponseParams{
			ActorUserID: turn.ActorUserID, TargetParticipantID: int32(turn.TargetParticipantID),
			ConversationUuid: conversationUUID, QuestionID: questionID,
			ResponseMessageID: responseMessageID, RegenerationKind: string(turn.Kind),
			ApplicationID:        int32(turn.ApplicationID),
			ApplicationVersionID: int32(turn.ApplicationVersionID),
			ExecutionGeneration:  turn.ExecutionGeneration, ExecutionID: executionID,
			ProjectID: int32(turn.ProjectID),
		},
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return agentexecutionapp.ErrUnsupportedCurrentAgentStart
	}
	if err != nil {
		return fmt.Errorf("reset current agent response: %w", err)
	}
	if row.ResponseMessageGroupID <= 0 || row.ResponseMessageID != responseMessageID {
		return errors.New("current agent regeneration returned an invalid response binding")
	}
	return nil
}

func insertCurrentApplicationTurn(
	ctx context.Context,
	queries *sqlcgen.Queries,
	executionID string,
	turn agentexecutionapp.CurrentApplicationTurn,
) error {
	conversationUUID, err := currentPGUUID(turn.ConversationUUID)
	if err != nil {
		return executionapp.ErrInvalidAdmission
	}
	questionID, err := currentPGUUID(turn.QuestionID)
	if err != nil {
		return executionapp.ErrInvalidAdmission
	}
	questionItemID, err := currentPGUUID(turn.QuestionItemID)
	if err != nil {
		return executionapp.ErrInvalidAdmission
	}
	responseMessageID, err := currentPGUUID(turn.ResponseMessageID)
	if err != nil {
		return executionapp.ErrInvalidAdmission
	}
	row, err := queries.InsertCurrentApplicationTurn(
		ctx,
		sqlcgen.InsertCurrentApplicationTurnParams{
			ActorUserID:          turn.ActorUserID,
			TargetParticipantID:  int32(turn.TargetParticipantID),
			ApplicationVersionID: int32(turn.ApplicationVersionID),
			ApplicationID:        int32(turn.ApplicationID),
			ConversationUuid:     conversationUUID,
			ProjectID:            int32(turn.ProjectID),
			QuestionID:           questionID,
			QuestionMeta:         append([]byte(nil), turn.QuestionMeta...),
			QuestionItemID:       questionItemID,
			UserInput:            turn.UserInput,
			ResponseMessageID:    responseMessageID,
			ExecutionID:          executionID,
			ExecutionGeneration:  turn.QuestionID,
		},
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return agentexecutionapp.ErrUnsupportedCurrentAgentStart
	}
	if err != nil {
		return fmt.Errorf("insert current agent chat turn: %w", err)
	}
	if row.ResponseMessageGroupID <= 0 || row.ResponseMessageID != responseMessageID {
		return errors.New("current agent chat turn returned an invalid response binding")
	}
	return nil
}

func insertCurrentAdhocTurn(
	ctx context.Context,
	queries *sqlcgen.Queries,
	executionID string,
	turn agentexecutionapp.CurrentAdhocTurn,
) error {
	conversationUUID, err := currentPGUUID(turn.ConversationUUID)
	if err != nil {
		return executionapp.ErrInvalidAdmission
	}
	questionID, err := currentPGUUID(turn.QuestionID)
	if err != nil {
		return executionapp.ErrInvalidAdmission
	}
	questionItemID, err := currentPGUUID(turn.QuestionItemID)
	if err != nil {
		return executionapp.ErrInvalidAdmission
	}
	responseMessageID, err := currentPGUUID(turn.ResponseMessageID)
	if err != nil {
		return executionapp.ErrInvalidAdmission
	}
	row, err := queries.InsertCurrentAdhocTurn(
		ctx,
		sqlcgen.InsertCurrentAdhocTurnParams{
			ActorUserID: turn.ActorUserID, TargetParticipantID: int32(turn.TargetParticipantID),
			ConversationUuid: conversationUUID, ProjectID: int32(turn.ProjectID),
			QuestionID: questionID, QuestionMeta: append([]byte(nil), turn.QuestionMeta...),
			QuestionItemID: questionItemID, UserInput: turn.UserInput,
			ResponseMessageID: responseMessageID, ExecutionGeneration: turn.QuestionID,
			ExecutionID: executionID,
		},
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return agentexecutionapp.ErrUnsupportedCurrentAgentStart
	}
	if err != nil {
		return fmt.Errorf("insert current ad-hoc agent chat turn: %w", err)
	}
	if row.ResponseMessageGroupID <= 0 || row.ResponseMessageID != responseMessageID {
		return errors.New("current ad-hoc agent chat turn returned an invalid response binding")
	}
	return nil
}

func resourceProjectIDUnchecked(value string) int64 {
	projectID, _ := strconv.ParseInt(value, 10, 64)
	return projectID
}

func loadAgentAdmission(
	ctx context.Context,
	queries *sqlcgen.Queries,
	scope,
	key string,
) (executionapp.AdmissionOutcome, runtimedomain.Digest, error) {
	row, err := queries.GetAgentExecutionAdmissionByIdempotency(
		ctx,
		sqlcgen.GetAgentExecutionAdmissionByIdempotencyParams{
			IdempotencyScope: scope,
			IdempotencyKey:   key,
		},
	)
	if err != nil {
		return executionapp.AdmissionOutcome{}, runtimedomain.Digest{}, err
	}
	digest, err := storedDigest(row.RequestDigest)
	if err != nil {
		return executionapp.AdmissionOutcome{}, runtimedomain.Digest{}, fmt.Errorf(
			"invalid stored agent request digest: %w",
			err,
		)
	}
	if row.Generation <= 0 || !row.AdmittedAt.Valid || !row.Deadline.Valid ||
		row.AdmittedAt.Time.IsZero() || !row.Deadline.Time.After(row.AdmittedAt.Time) {
		return executionapp.AdmissionOutcome{}, runtimedomain.Digest{},
			errors.New("stored agent admission is invalid")
	}
	return executionapp.AdmissionOutcome{
		ExecutionID: row.ExecutionID,
		CommandID:   row.CommandID,
		Created:     false,
		AdmittedAt:  row.AdmittedAt.Time.UTC(),
		Deadline:    row.Deadline.Time.UTC(),
	}, digest, nil
}

func boundedAgentAdmissionStrings(admission agentexecutionapp.Admission) bool {
	record := admission.Record
	binding := admission.Binding
	values := []string{
		record.IdempotencyScope,
		record.IdempotencyKey,
		record.InputBundle.ID,
		record.InputBundle.Version,
		record.InputBundle.MediaType,
		record.Job.ID,
		record.Job.CommandID,
		record.Job.TenantID,
		record.Job.ResourceProjectID,
		record.Job.ProjectionProjectID,
		record.Job.ActorID,
		record.Job.CapabilityID,
		record.Outbox.ID,
		binding.RequestEntryID,
		binding.ClientStreamID,
		binding.ClientMessageID,
		binding.ClientExecutionGeneration,
		binding.SIOEvent,
	}
	for _, entry := range record.InputBundle.Entries {
		values = append(
			values,
			entry.ID,
			entry.Version,
			entry.SemanticRole,
			entry.ContentID,
			entry.MediaType,
			entry.Classification,
			entry.RequiredGrantAudience,
		)
	}
	for _, value := range values {
		if value == "" || len(value) > executiondomain.MaxIndexMetaCorrelationBytes ||
			strings.ContainsAny(value, "\x00\r\n") {
			return false
		}
	}
	return true
}

func agentExecutionCapability(capabilityID string) bool {
	return capabilityID == executiondomain.AgentApplicationCapability ||
		capabilityID == executiondomain.AgentAdhocCapability
}

var _ agentexecutionapp.AtomicAdmissionStore = (*AgentExecutionJobsRepository)(nil)
