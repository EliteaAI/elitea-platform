package configurations

import (
	"context"
	"errors"
	"sort"
	"strings"
	"sync"
)

const (
	MaxCurrentDeletedLLMProjects            = 10_000
	MaxCurrentDeletedLLMConcurrency         = 8
	MaxCurrentDeletedLLMApplicationVersions = 100_000
	MaxCurrentDeletedLLMModelNameBytes      = 1_024
)

// CurrentDeletedLLMProjectRepository returns active project database
// identities only. It must apply maxRows before materializing an unbounded
// result; callers pass one extra row to detect overflow.
type CurrentDeletedLLMProjectRepository interface {
	ListActiveCurrentProjectIDs(context.Context, int) ([]int32, error)
}

type CurrentDeletedLLMModelCatalog interface {
	Get(context.Context, CurrentModelCatalogQuery) (CurrentModelCatalogResponse, error)
}

type CurrentDeletedLLMReferenceReplacement struct {
	ProjectID             int32
	DeletedModelName      string
	DefaultModelName      string
	DefaultModelProjectID int32
	MaxRows               int
}

// CurrentDeletedLLMApplicationRepository atomically updates at most MaxRows
// application_versions whose llm_settings.model_name exactly matches
// DeletedModelName. It must merge only model_name and model_project_id into the
// existing JSON object, preserving every other setting, and must make no change
// if the match count exceeds MaxRows.
type CurrentDeletedLLMApplicationRepository interface {
	ReplaceCurrentDeletedLLMApplicationReferences(
		context.Context,
		CurrentDeletedLLMReferenceReplacement,
	) (int, error)
}

// CurrentDeletedLLMReferenceEffect repairs application-version defaults after
// a configuration delete. Public-project deletions fan out over a bounded
// active-project snapshot; each per-project operation is idempotent because the
// repository matches only the deleted model name.
type CurrentDeletedLLMReferenceEffect struct {
	projects        CurrentDeletedLLMProjectRepository
	catalog         CurrentDeletedLLMModelCatalog
	applications    CurrentDeletedLLMApplicationRepository
	publicProjectID int32
}

func NewCurrentDeletedLLMReferenceEffect(
	projects CurrentDeletedLLMProjectRepository,
	catalog CurrentDeletedLLMModelCatalog,
	applications CurrentDeletedLLMApplicationRepository,
	publicProjectID int32,
) (*CurrentDeletedLLMReferenceEffect, error) {
	if projects == nil || catalog == nil || applications == nil || publicProjectID <= 0 {
		return nil, ErrInvalidCurrentConfigurationLifecycleInternalEffect
	}
	return &CurrentDeletedLLMReferenceEffect{
		projects: projects, catalog: catalog, applications: applications, publicProjectID: publicProjectID,
	}, nil
}

func (e *CurrentDeletedLLMReferenceEffect) RepairCurrentDeletedLLMReferences(
	ctx context.Context,
	effect CurrentDeletedLLMEffect,
) error {
	if !validCurrentDeletedLLMEffect(ctx, e, effect) {
		return ErrInvalidCurrentConfigurationLifecycleInternalEffect
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	projectIDs, err := e.currentDeletedLLMTargetProjects(ctx, effect.ProjectID)
	if err != nil {
		return err
	}
	return e.repairCurrentDeletedLLMProjects(ctx, projectIDs, effect.ModelName)
}

func (e *CurrentDeletedLLMReferenceEffect) currentDeletedLLMTargetProjects(
	ctx context.Context,
	deletedFromProjectID int32,
) ([]int32, error) {
	if deletedFromProjectID != e.publicProjectID {
		return []int32{deletedFromProjectID}, nil
	}

	projectIDs, err := e.projects.ListActiveCurrentProjectIDs(ctx, MaxCurrentDeletedLLMProjects+1)
	if err != nil {
		if errors.Is(err, ErrCurrentConfigurationLifecycleInternalLimit) {
			return nil, ErrCurrentConfigurationLifecycleInternalLimit
		}
		return nil, currentConfigurationLifecycleInternalDependencyError(ctx, err)
	}
	if len(projectIDs) > MaxCurrentDeletedLLMProjects {
		return nil, ErrCurrentConfigurationLifecycleInternalLimit
	}

	unique := make(map[int32]struct{}, len(projectIDs)+1)
	unique[e.publicProjectID] = struct{}{}
	for _, projectID := range projectIDs {
		if projectID <= 0 {
			return nil, ErrInvalidCurrentConfigurationLifecycleInternalEffect
		}
		unique[projectID] = struct{}{}
	}
	if len(unique) > MaxCurrentDeletedLLMProjects {
		return nil, ErrCurrentConfigurationLifecycleInternalLimit
	}

	result := make([]int32, 0, len(unique))
	for projectID := range unique {
		result = append(result, projectID)
	}
	sort.Slice(result, func(left, right int) bool { return result[left] < result[right] })
	return result, nil
}

func (e *CurrentDeletedLLMReferenceEffect) repairCurrentDeletedLLMProjects(
	ctx context.Context,
	projectIDs []int32,
	deletedModelName string,
) error {
	if len(projectIDs) == 0 {
		return nil
	}

	type currentDeletedLLMProjectWork struct {
		index     int
		projectID int32
	}
	jobs := make(chan currentDeletedLLMProjectWork)
	errorsByProject := make([]error, len(projectIDs))
	workers := min(MaxCurrentDeletedLLMConcurrency, len(projectIDs))
	var group sync.WaitGroup
	group.Add(workers)
	for range workers {
		go func() {
			defer group.Done()
			for work := range jobs {
				if ctx.Err() != nil {
					return
				}
				errorsByProject[work.index] = e.repairCurrentDeletedLLMProject(
					ctx,
					work.projectID,
					deletedModelName,
				)
			}
		}()
	}

send:
	for index, projectID := range projectIDs {
		select {
		case jobs <- currentDeletedLLMProjectWork{index: index, projectID: projectID}:
		case <-ctx.Done():
			break send
		}
	}
	close(jobs)
	group.Wait()
	if err := ctx.Err(); err != nil {
		return err
	}
	return errors.Join(errorsByProject...)
}

func (e *CurrentDeletedLLMReferenceEffect) repairCurrentDeletedLLMProject(
	ctx context.Context,
	projectID int32,
	deletedModelName string,
) error {
	catalog, err := e.catalog.Get(ctx, CurrentModelCatalogQuery{
		Section:         CurrentModelSectionLLM,
		ProjectID:       projectID,
		PublicProjectID: e.publicProjectID,
		IncludeShared:   true,
	})
	if err != nil {
		return currentConfigurationLifecycleInternalDependencyError(ctx, err)
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	defaultAvailable := false
	for _, item := range catalog.Items {
		if item.Name == deletedModelName {
			return nil
		}
		if catalog.DefaultModelName != nil && catalog.DefaultModelProjectID != nil &&
			item.Name == *catalog.DefaultModelName && item.ProjectID == *catalog.DefaultModelProjectID {
			defaultAvailable = true
		}
	}
	if catalog.DefaultModelName == nil || *catalog.DefaultModelName == "" ||
		catalog.DefaultModelProjectID == nil || *catalog.DefaultModelProjectID <= 0 || !defaultAvailable {
		return ErrCurrentDeletedLLMDefaultUnavailable
	}

	updated, err := e.applications.ReplaceCurrentDeletedLLMApplicationReferences(
		ctx,
		CurrentDeletedLLMReferenceReplacement{
			ProjectID:             projectID,
			DeletedModelName:      deletedModelName,
			DefaultModelName:      *catalog.DefaultModelName,
			DefaultModelProjectID: *catalog.DefaultModelProjectID,
			MaxRows:               MaxCurrentDeletedLLMApplicationVersions,
		},
	)
	if err != nil {
		if errors.Is(err, ErrCurrentConfigurationLifecycleInternalLimit) {
			return ErrCurrentConfigurationLifecycleInternalLimit
		}
		return currentConfigurationLifecycleInternalDependencyError(ctx, err)
	}
	if updated < 0 {
		return ErrInvalidCurrentConfigurationLifecycleInternalEffect
	}
	if updated > MaxCurrentDeletedLLMApplicationVersions {
		return ErrCurrentConfigurationLifecycleInternalLimit
	}
	return nil
}

func validCurrentDeletedLLMEffect(
	ctx context.Context,
	service *CurrentDeletedLLMReferenceEffect,
	effect CurrentDeletedLLMEffect,
) bool {
	return ctx != nil && service != nil && service.projects != nil && service.catalog != nil &&
		service.applications != nil && service.publicProjectID > 0 &&
		validCurrentConfigurationLifecycleIdentity(effect.EffectID) &&
		validCurrentConfigurationLifecycleIdentity(effect.EventID) && effect.Revision > 0 &&
		effect.ProjectID > 0 && effect.ModelName != "" &&
		len(effect.ModelName) <= MaxCurrentDeletedLLMModelNameBytes &&
		effect.ModelName == strings.TrimSpace(effect.ModelName) &&
		!strings.ContainsRune(effect.ModelName, '\x00')
}

var _ CurrentDeletedLLMEffects = (*CurrentDeletedLLMReferenceEffect)(nil)
