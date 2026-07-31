package indexschedule

import (
	"context"
	"errors"
	"testing"
)

type deleteStoreStub struct {
	mutation DeleteMutation
	result   DeleteResult
	err      error
}

func (store *deleteStoreStub) Delete(
	_ context.Context,
	mutation DeleteMutation,
) (DeleteResult, error) {
	store.mutation = mutation
	return store.result, store.err
}

func TestDeleteServicePreservesDefaultTeamAndOtherUserTargets(t *testing.T) {
	for _, test := range []struct {
		name   string
		target *string
		want   string
	}{
		{name: "defaults to caller", want: "11"},
		{name: "team", target: stringPointer("-1"), want: "-1"},
		{
			name:   "other editor-owned target",
			target: stringPointer("17"),
			want:   "17",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := &deleteStoreStub{
				result: DeleteResult{IndexesMeta: map[string]any{}},
			}
			service, err := NewDeleteService(store)
			if err != nil {
				t.Fatal(err)
			}
			_, err = service.Delete(context.Background(), DeleteRequest{
				ProjectID: 7, ActorUserID: 11, ToolkitID: 9,
				IndexMetaID: "docs", TargetUserID: test.target,
			})
			if err != nil || store.mutation.TargetKey != test.want {
				t.Fatalf("mutation=%+v error=%v", store.mutation, err)
			}
		})
	}
}

func TestDeleteServicePreservesExplicitEmptyTargetAsNotFound(t *testing.T) {
	service, err := NewDeleteService(&deleteStoreStub{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.Delete(context.Background(), DeleteRequest{
		ProjectID: 7, ActorUserID: 11, ToolkitID: 9,
		IndexMetaID: "docs", TargetUserID: stringPointer(""),
	})
	if !errors.Is(err, ErrScheduleUserNotFound) {
		t.Fatalf("error=%v", err)
	}
}

func TestDeleteServiceRejectsInvalidIdentity(t *testing.T) {
	service, err := NewDeleteService(&deleteStoreStub{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.Delete(context.Background(), DeleteRequest{
		ProjectID: 7, ToolkitID: 9, IndexMetaID: "docs",
	})
	if !errors.Is(err, ErrInvalidRequest) {
		t.Fatalf("error=%v", err)
	}
}

func stringPointer(value string) *string {
	return &value
}
