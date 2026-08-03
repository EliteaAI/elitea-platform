package repos

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	agentexecutionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/agentexecution"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
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

type currentAgentStartQuerier interface {
	ResolveCurrentApplicationTurn(
		context.Context,
		sqlcgen.ResolveCurrentApplicationTurnParams,
	) (sqlcgen.ResolveCurrentApplicationTurnRow, error)
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
			queries, ok := tx.(currentAgentStartQuerier)
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

func currentPGUUID(value string) (pgtype.UUID, error) {
	var result pgtype.UUID
	if err := result.Scan(value); err != nil || !result.Valid {
		return pgtype.UUID{}, errors.New("invalid UUID")
	}
	return result, nil
}
