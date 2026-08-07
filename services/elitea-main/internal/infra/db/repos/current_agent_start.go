package repos

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"

	agentexecutionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/agentexecution"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type CurrentAgentStartRepository struct {
	projects projectStore
}

func NewCurrentAgentStartRepository(pool *pgxpool.Pool) (*CurrentAgentStartRepository, error) {
	projects, err := newPostgresProjectStore(pool)
	if err != nil {
		return nil, err
	}
	return newCurrentAgentStartRepository(projects)
}

func newCurrentAgentStartRepository(projects projectStore) (*CurrentAgentStartRepository, error) {
	if projects == nil {
		return nil, errors.New("current agent project database is required")
	}
	return &CurrentAgentStartRepository{projects: projects}, nil
}

type currentApplicationStartQuerier interface {
	ResolveCurrentApplicationTurn(
		context.Context,
		sqlcgen.ResolveCurrentApplicationTurnParams,
	) (sqlcgen.ResolveCurrentApplicationTurnRow, error)
}

type currentAdhocStartQuerier interface {
	ResolveCurrentAdhocTurn(
		context.Context,
		sqlcgen.ResolveCurrentAdhocTurnParams,
	) (sqlcgen.ResolveCurrentAdhocTurnRow, error)
}

type currentRegenerationQuerier interface {
	ResolveCurrentRegeneration(
		context.Context,
		sqlcgen.ResolveCurrentRegenerationParams,
	) (sqlcgen.ResolveCurrentRegenerationRow, error)
}

type currentContinuationQuerier interface {
	ResolveCurrentContinuation(
		context.Context,
		sqlcgen.ResolveCurrentContinuationParams,
	) (sqlcgen.ResolveCurrentContinuationRow, error)
	ResolveCurrentAuthorizationContinuation(
		context.Context,
		sqlcgen.ResolveCurrentAuthorizationContinuationParams,
	) (sqlcgen.ResolveCurrentAuthorizationContinuationRow, error)
}

func (repository *CurrentAgentStartRepository) ResolveCurrentApplication(
	ctx context.Context,
	request agentexecutionapp.CurrentApplicationStartRequest,
) (agentexecutionapp.CurrentApplicationTarget, error) {
	if err := request.Validate(); err != nil {
		return agentexecutionapp.CurrentApplicationTarget{}, agentexecutionapp.ErrInvalidCurrentAgentStart
	}
	projectID, projectIDValid := currentAgentDatabaseID(request.ProjectID)
	targetParticipantID, targetParticipantIDValid := currentAgentDatabaseID(request.TargetParticipantID)
	if !projectIDValid || !targetParticipantIDValid {
		return agentexecutionapp.CurrentApplicationTarget{}, agentexecutionapp.ErrInvalidCurrentAgentStart
	}
	conversationUUID, err := currentPGUUID(request.ConversationUUID)
	if err != nil {
		return agentexecutionapp.CurrentApplicationTarget{}, agentexecutionapp.ErrInvalidCurrentAgentStart
	}
	questionID, err := currentPGUUID(request.QuestionID)
	if err != nil {
		return agentexecutionapp.CurrentApplicationTarget{}, agentexecutionapp.ErrInvalidCurrentAgentStart
	}
	var target agentexecutionapp.CurrentApplicationTarget
	err = repository.projects.WithinProjectTx(
		ctx,
		request.ProjectID,
		pgx.TxOptions{IsoLevel: pgx.ReadCommitted, AccessMode: pgx.ReadOnly},
		func(tx sqlExecutor) error {
			queries, ok := tx.(currentApplicationStartQuerier)
			if !ok {
				return errors.New("current agent start query is unavailable")
			}
			nesting, ok := tx.(currentApplicationNestingQuerier)
			if !ok {
				return errors.New("current application nesting query is unavailable")
			}
			row, queryErr := queries.ResolveCurrentApplicationTurn(
				ctx,
				sqlcgen.ResolveCurrentApplicationTurnParams{
					ActorUserID:         request.ActorUserID,
					TargetParticipantID: targetParticipantID,
					QuestionID:          questionID,
					ConversationUuid:    conversationUUID,
					ProjectID:           projectID,
				},
			)
			if errors.Is(queryErr, pgx.ErrNoRows) {
				return agentexecutionapp.ErrUnsupportedCurrentAgentStart
			}
			if queryErr != nil {
				return fmt.Errorf("resolve current application turn: %w", queryErr)
			}
			variables := json.RawMessage(row.ApplicationVariablesJson)
			versionDetails := json.RawMessage(row.ApplicationVersionDetailsJson)
			chatHistory := json.RawMessage(row.ChatHistoryJson)
			if int64(row.ApplicationProjectID) != request.ProjectID ||
				row.ApplicationID <= 0 || row.ApplicationVersionID <= 0 ||
				!json.Valid(variables) || !json.Valid(versionDetails) ||
				!json.Valid(chatHistory) {
				return agentexecutionapp.ErrUnsupportedCurrentAgentStart
			}
			if validationErr := validateCurrentApplicationNesting(
				ctx,
				nesting,
				row.ApplicationVersionID,
				1,
			); validationErr != nil {
				if contextErr := ctx.Err(); contextErr != nil {
					return contextErr
				}
				if errors.Is(validationErr, errInvalidCurrentApplicationNesting) {
					return agentexecutionapp.ErrUnsupportedCurrentAgentStart
				}
				return fmt.Errorf("validate current application nesting: %w", validationErr)
			}
			target = agentexecutionapp.CurrentApplicationTarget{
				ApplicationID:        int64(row.ApplicationID),
				ApplicationVersionID: int64(row.ApplicationVersionID),
				Variables:            variables,
				VersionDetails:       versionDetails,
				ChatHistory:          chatHistory,
			}
			return nil
		},
	)
	if err != nil {
		return agentexecutionapp.CurrentApplicationTarget{}, err
	}
	return target, nil
}

func (repository *CurrentAgentStartRepository) ResolveCurrentAdhoc(
	ctx context.Context,
	request agentexecutionapp.CurrentAdhocStartRequest,
) (agentexecutionapp.CurrentAdhocTarget, error) {
	if err := request.Validate(); err != nil {
		return agentexecutionapp.CurrentAdhocTarget{}, agentexecutionapp.ErrInvalidCurrentAgentStart
	}
	projectID, projectIDValid := currentAgentDatabaseID(request.ProjectID)
	if !projectIDValid || request.TargetParticipantID > math.MaxInt32 {
		return agentexecutionapp.CurrentAdhocTarget{}, agentexecutionapp.ErrInvalidCurrentAgentStart
	}
	conversationUUID, err := currentPGUUID(request.ConversationUUID)
	if err != nil {
		return agentexecutionapp.CurrentAdhocTarget{}, agentexecutionapp.ErrInvalidCurrentAgentStart
	}
	questionID, err := currentPGUUID(request.QuestionID)
	if err != nil {
		return agentexecutionapp.CurrentAdhocTarget{}, agentexecutionapp.ErrInvalidCurrentAgentStart
	}
	var target agentexecutionapp.CurrentAdhocTarget
	err = repository.projects.WithinProjectTx(
		ctx,
		request.ProjectID,
		pgx.TxOptions{IsoLevel: pgx.ReadCommitted, AccessMode: pgx.ReadOnly},
		func(tx sqlExecutor) error {
			queries, ok := tx.(currentAdhocStartQuerier)
			if !ok {
				return errors.New("current agent start query is unavailable")
			}
			nesting, ok := tx.(currentApplicationNestingQuerier)
			if !ok {
				return errors.New("current application nesting query is unavailable")
			}
			row, queryErr := queries.ResolveCurrentAdhocTurn(
				ctx,
				sqlcgen.ResolveCurrentAdhocTurnParams{
					ActorUserID: request.ActorUserID, TargetParticipantID: int32(request.TargetParticipantID),
					ProjectID: projectID, QuestionID: questionID, ConversationUuid: conversationUUID,
				},
			)
			if errors.Is(queryErr, pgx.ErrNoRows) {
				return agentexecutionapp.ErrUnsupportedCurrentAgentStart
			}
			if queryErr != nil {
				return fmt.Errorf("resolve current ad-hoc turn: %w", queryErr)
			}
			llmSettings := json.RawMessage(row.LlmSettingsJson)
			tools := json.RawMessage(row.ToolsJson)
			chatHistory := json.RawMessage(row.ChatHistoryJson)
			conversationMeta := json.RawMessage(row.ConversationMetaJson)
			if row.TargetParticipantID <= 0 ||
				(request.TargetParticipantID > 0 && int64(row.TargetParticipantID) != request.TargetParticipantID) ||
				!json.Valid(llmSettings) || !json.Valid(tools) || !json.Valid(chatHistory) ||
				!json.Valid(conversationMeta) {
				return agentexecutionapp.ErrUnsupportedCurrentAgentStart
			}
			tools, queryErr = filterCurrentAdhocApplicationNesting(ctx, nesting, tools)
			if queryErr != nil {
				if contextErr := ctx.Err(); contextErr != nil {
					return contextErr
				}
				if errors.Is(queryErr, errInvalidCurrentApplicationNesting) {
					return agentexecutionapp.ErrUnsupportedCurrentAgentStart
				}
				return fmt.Errorf("validate current ad-hoc application nesting: %w", queryErr)
			}
			target = agentexecutionapp.CurrentAdhocTarget{
				TargetParticipantID: int64(row.TargetParticipantID),
				LLMSettings:         llmSettings, Instructions: row.Instructions,
				Tools: tools, ChatHistory: chatHistory, ConversationMeta: conversationMeta,
			}
			return nil
		},
	)
	if err != nil {
		return agentexecutionapp.CurrentAdhocTarget{}, err
	}
	return target, nil
}

func (repository *CurrentAgentStartRepository) ResolveCurrentRegeneration(
	ctx context.Context,
	request agentexecutionapp.CurrentRegenerationResolveRequest,
) (agentexecutionapp.CurrentRegenerationTarget, error) {
	if err := request.Validate(); err != nil {
		return agentexecutionapp.CurrentRegenerationTarget{}, agentexecutionapp.ErrInvalidCurrentAgentStart
	}
	projectID, projectIDValid := currentAgentDatabaseID(request.ProjectID)
	if !projectIDValid {
		return agentexecutionapp.CurrentRegenerationTarget{}, agentexecutionapp.ErrInvalidCurrentAgentStart
	}
	responseMessageID, err := currentPGUUID(request.ResponseMessageID)
	if err != nil {
		return agentexecutionapp.CurrentRegenerationTarget{}, agentexecutionapp.ErrInvalidCurrentAgentStart
	}
	var target agentexecutionapp.CurrentRegenerationTarget
	err = repository.projects.WithinProjectTx(
		ctx,
		request.ProjectID,
		pgx.TxOptions{IsoLevel: pgx.ReadCommitted, AccessMode: pgx.ReadOnly},
		func(tx sqlExecutor) error {
			queries, ok := tx.(currentRegenerationQuerier)
			if !ok {
				return errors.New("current agent regeneration query is unavailable")
			}
			row, queryErr := queries.ResolveCurrentRegeneration(
				ctx,
				sqlcgen.ResolveCurrentRegenerationParams{
					ActorUserID: request.ActorUserID, ProjectID: projectID,
					ResponseMessageID: responseMessageID,
				},
			)
			if errors.Is(queryErr, pgx.ErrNoRows) {
				return agentexecutionapp.ErrUnsupportedCurrentAgentStart
			}
			if queryErr != nil {
				return fmt.Errorf("resolve current agent regeneration: %w", queryErr)
			}
			if row.ResponseIsStreaming {
				return agentexecutionapp.ErrCurrentAgentRegenerationStillFinalizing
			}
			target = agentexecutionapp.CurrentRegenerationTarget{
				Kind:                agentexecutionapp.CurrentRegenerationKind(row.RegenerationKind),
				ConversationUUID:    uuid.UUID(row.ConversationUuid.Bytes).String(),
				TargetParticipantID: int64(row.TargetParticipantID),
				QuestionID:          uuid.UUID(row.QuestionID.Bytes).String(), UserInput: row.UserInput,
			}
			if err := target.Validate(); err != nil {
				return agentexecutionapp.ErrUnsupportedCurrentAgentStart
			}
			return nil
		},
	)
	if err != nil {
		return agentexecutionapp.CurrentRegenerationTarget{}, err
	}
	return target, nil
}

func (repository *CurrentAgentStartRepository) ResolveCurrentContinuation(
	ctx context.Context,
	request agentexecutionapp.CurrentContinuationResolveRequest,
) (agentexecutionapp.CurrentContinuationTarget, error) {
	if err := request.Validate(); err != nil {
		return agentexecutionapp.CurrentContinuationTarget{}, agentexecutionapp.ErrInvalidCurrentAgentStart
	}
	projectID, projectIDValid := currentAgentDatabaseID(request.ProjectID)
	if !projectIDValid {
		return agentexecutionapp.CurrentContinuationTarget{}, agentexecutionapp.ErrInvalidCurrentAgentStart
	}
	conversationUUID, err := currentPGUUID(request.ConversationUUID)
	if err != nil {
		return agentexecutionapp.CurrentContinuationTarget{}, agentexecutionapp.ErrInvalidCurrentAgentStart
	}
	responseMessageID, err := currentPGUUID(request.ResponseMessageID)
	if err != nil {
		return agentexecutionapp.CurrentContinuationTarget{}, agentexecutionapp.ErrInvalidCurrentAgentStart
	}
	var target agentexecutionapp.CurrentContinuationTarget
	err = repository.projects.WithinProjectTx(
		ctx,
		request.ProjectID,
		pgx.TxOptions{IsoLevel: pgx.ReadCommitted, AccessMode: pgx.ReadOnly},
		func(tx sqlExecutor) error {
			queries, ok := tx.(currentContinuationQuerier)
			if !ok {
				return errors.New("current agent continuation query is unavailable")
			}
			if request.Kind == agentexecutionapp.CurrentContinuationAuthorization {
				row, queryErr := queries.ResolveCurrentAuthorizationContinuation(
					ctx,
					sqlcgen.ResolveCurrentAuthorizationContinuationParams{
						ActorUserID: request.ActorUserID, ProjectID: projectID,
						ConversationUuid: conversationUUID, ResponseMessageID: responseMessageID,
						AuthorizationRequestID: request.AuthorizationID,
					},
				)
				if errors.Is(queryErr, pgx.ErrNoRows) {
					return agentexecutionapp.ErrCurrentAgentAuthorizationAlreadyResolved
				}
				if queryErr != nil {
					return fmt.Errorf("resolve current agent authorization continuation: %w", queryErr)
				}
				var authorizationRequests []struct {
					ToolRunID string `json:"tool_run_id"`
				}
				if json.Unmarshal([]byte(row.AuthorizationRequestsJson), &authorizationRequests) != nil ||
					len(authorizationRequests) == 0 || len(authorizationRequests) > 16 {
					return agentexecutionapp.ErrUnsupportedCurrentAgentStart
				}
				matched := 0
				for _, authorizationRequest := range authorizationRequests {
					if authorizationRequest.ToolRunID == request.AuthorizationID {
						matched++
					}
				}
				if matched != 1 {
					return agentexecutionapp.ErrUnsupportedCurrentAgentStart
				}
				target = agentexecutionapp.CurrentContinuationTarget{
					ContinuationKind:    agentexecutionapp.CurrentContinuationAuthorization,
					Kind:                agentexecutionapp.CurrentRegenerationKind(row.ContinuationKind),
					TargetParticipantID: int64(row.TargetParticipantID),
					QuestionID:          uuid.UUID(row.QuestionID.Bytes).String(),
					UserInput:           row.UserInput,
					ThreadID:            row.ThreadID,
					ExecutionGeneration: row.ExecutionGeneration,
					InterruptID:         request.AuthorizationID,
					AvailableActions:    []string{"authorize", "skip"},
				}
				if uuid.UUID(row.ConversationUuid.Bytes).String() != request.ConversationUUID ||
					target.Validate() != nil {
					return agentexecutionapp.ErrUnsupportedCurrentAgentStart
				}
				return nil
			}
			row, queryErr := queries.ResolveCurrentContinuation(
				ctx,
				sqlcgen.ResolveCurrentContinuationParams{
					ActorUserID: request.ActorUserID, ProjectID: projectID,
					ConversationUuid: conversationUUID, ResponseMessageID: responseMessageID,
				},
			)
			if errors.Is(queryErr, pgx.ErrNoRows) {
				return agentexecutionapp.ErrCurrentAgentHITLAlreadyResolved
			}
			if queryErr != nil {
				return fmt.Errorf("resolve current agent continuation: %w", queryErr)
			}
			var interrupt struct {
				InterruptID      string   `json:"interrupt_id"`
				AvailableActions []string `json:"available_actions"`
			}
			var rawInterrupt map[string]any
			if json.Unmarshal([]byte(row.HitlInterruptJson), &interrupt) != nil ||
				json.Unmarshal([]byte(row.HitlInterruptJson), &rawInterrupt) != nil ||
				!validSequentialHITLInterrupt(rawInterrupt) {
				return agentexecutionapp.ErrUnsupportedCurrentAgentStart
			}
			target = agentexecutionapp.CurrentContinuationTarget{
				ContinuationKind:    agentexecutionapp.CurrentContinuationHITL,
				Kind:                agentexecutionapp.CurrentRegenerationKind(row.ContinuationKind),
				TargetParticipantID: int64(row.TargetParticipantID),
				QuestionID:          uuid.UUID(row.QuestionID.Bytes).String(), UserInput: row.UserInput,
				ThreadID: row.ThreadID, ExecutionGeneration: row.ExecutionGeneration,
				InterruptID:      interrupt.InterruptID,
				AvailableActions: append([]string(nil), interrupt.AvailableActions...),
			}
			if uuid.UUID(row.ConversationUuid.Bytes).String() != request.ConversationUUID ||
				target.Validate() != nil {
				return agentexecutionapp.ErrUnsupportedCurrentAgentStart
			}
			return nil
		},
	)
	if err != nil {
		return agentexecutionapp.CurrentContinuationTarget{}, err
	}
	return target, nil
}

func currentPGUUID(value string) (pgtype.UUID, error) {
	var result pgtype.UUID
	if err := result.Scan(value); err != nil || !result.Valid {
		return pgtype.UUID{}, errors.New("invalid UUID")
	}
	return result, nil
}

var _ currentApplicationStartQuerier = pgxExecutor{}
var _ currentAdhocStartQuerier = pgxExecutor{}
var _ currentRegenerationQuerier = pgxExecutor{}
var _ currentContinuationQuerier = pgxExecutor{}
