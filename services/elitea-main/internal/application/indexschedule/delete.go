package indexschedule

import (
	"context"
	"errors"
	"math"
	"strconv"
	"strings"
)

var (
	ErrScheduleIndexNotFound = errors.New("index schedule index was not found")
	ErrScheduleUserNotFound  = errors.New("index schedule user was not found")
)

type DeleteRequest struct {
	ProjectID    int64
	ActorUserID  int64
	ToolkitID    int64
	IndexMetaID  string
	TargetUserID *string
}

type DeleteMutation struct {
	ProjectID   int64
	ToolkitID   int64
	IndexMetaID string
	TargetKey   string
}

type DeleteResult struct {
	IndexesMeta map[string]any
}

type DeleteStore interface {
	Delete(context.Context, DeleteMutation) (DeleteResult, error)
}

type DeleteService struct {
	store DeleteStore
}

func NewDeleteService(store DeleteStore) (*DeleteService, error) {
	if store == nil {
		return nil, errors.New("index schedule delete dependencies are required")
	}
	return &DeleteService{store: store}, nil
}

func (service *DeleteService) Delete(
	ctx context.Context,
	request DeleteRequest,
) (DeleteResult, error) {
	if service == nil || service.store == nil || ctx == nil ||
		request.ProjectID <= 0 || request.ProjectID > math.MaxInt32 ||
		request.ActorUserID <= 0 || request.ActorUserID > math.MaxInt32 ||
		request.ToolkitID <= 0 || request.ToolkitID > math.MaxInt32 ||
		!validIndexMetaID(request.IndexMetaID) ||
		(request.TargetUserID != nil &&
			(len(*request.TargetUserID) > 64 ||
				strings.ContainsAny(*request.TargetUserID, "\x00\r\n"))) {
		return DeleteResult{}, ErrInvalidRequest
	}
	if err := ctx.Err(); err != nil {
		return DeleteResult{}, err
	}
	target := ""
	if request.TargetUserID == nil {
		target = strconv.FormatInt(request.ActorUserID, 10)
	} else {
		target = *request.TargetUserID
		if target == "" {
			return DeleteResult{}, ErrScheduleUserNotFound
		}
	}
	return service.store.Delete(ctx, DeleteMutation{
		ProjectID:   request.ProjectID,
		ToolkitID:   request.ToolkitID,
		IndexMetaID: request.IndexMetaID,
		TargetKey:   target,
	})
}
