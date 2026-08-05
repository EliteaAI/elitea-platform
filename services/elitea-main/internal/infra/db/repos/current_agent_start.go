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
