package indexmeta

import (
	"context"
	"errors"
	"strings"

	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
)

type ExactExternalReader interface {
	FindExact(
		context.Context,
		ResolvedTarget,
		string,
	) (RawRecord, bool, error)
}

// ExactService resolves the saved project PgVector target and reads only one
// exact type=index_meta collection. It is the bounded scheduler-side
// equivalent of the current Python `.filter(...collection...).first()` path,
// except duplicate exact rows fail closed.
type ExactService struct {
	toolkits indexingapp.CurrentToolkitReader
	settings indexingapp.CurrentToolkitSettingsValidator
	reader   ExactExternalReader
}

func NewExactService(
	toolkits indexingapp.CurrentToolkitReader,
	settings indexingapp.CurrentToolkitSettingsValidator,
	reader ExactExternalReader,
) (*ExactService, error) {
	if toolkits == nil || settings == nil || reader == nil {
		return nil, errors.New("exact current index meta dependencies are required")
	}
	return &ExactService{
		toolkits: toolkits,
		settings: settings,
		reader:   reader,
	}, nil
}

func (service *ExactService) Find(
	ctx context.Context,
	request Request,
	collection string,
) (Item, bool, error) {
	if service == nil || service.toolkits == nil ||
		service.settings == nil || service.reader == nil ||
		collection == "" ||
		len(collection) > MaxCurrentIndexMetaIDBytes ||
		strings.ContainsAny(collection, "\x00\r\n") {
		return Item{}, false, ErrInvalidCurrentIndexMetaRequest
	}
	target, err := ResolveCurrentTarget(
		ctx,
		service.toolkits,
		service.settings,
		request,
		2,
	)
	if err != nil {
		return Item{}, false, err
	}
	return service.findTarget(ctx, target, collection)
}

// FindSnapshot resolves the exact PgVector target from an already loaded
// toolkit snapshot. Scheduling uses this to keep its metadata preflight and
// frozen execution inputs on one coherent saved-settings view.
func (service *ExactService) FindSnapshot(
	ctx context.Context,
	request Request,
	collection string,
	toolkit indexingapp.CurrentToolkitSnapshot,
) (Item, bool, error) {
	if service == nil || service.settings == nil || service.reader == nil ||
		collection == "" ||
		len(collection) > MaxCurrentIndexMetaIDBytes ||
		strings.ContainsAny(collection, "\x00\r\n") {
		return Item{}, false, ErrInvalidCurrentIndexMetaRequest
	}
	target, err := ResolveCurrentTargetSnapshot(
		ctx,
		service.settings,
		request,
		toolkit,
		2,
	)
	if err != nil {
		return Item{}, false, err
	}
	return service.findTarget(ctx, target, collection)
}

func (service *ExactService) findTarget(
	ctx context.Context,
	target ResolvedTarget,
	collection string,
) (Item, bool, error) {
	record, found, err := service.reader.FindExact(
		ctx,
		target,
		collection,
	)
	if err != nil {
		if errors.Is(err, ErrCurrentIndexMetaLimitExceeded) ||
			errors.Is(err, ErrCurrentIndexMetaInvalid) {
			return Item{}, false, err
		}
		return Item{}, false, currentIndexMetaDependencyError(
			ctx,
			ErrCurrentIndexMetaUnavailable,
			err,
		)
	}
	if !found {
		return Item{}, false, nil
	}
	if record.ID == "" ||
		len(record.ID) > MaxCurrentIndexMetaIDBytes ||
		len(record.Metadata) == 0 ||
		len(record.Metadata) > MaxCurrentIndexMetaMetadataBytes {
		return Item{}, false, ErrCurrentIndexMetaInvalid
	}
	metadata, err := decodeCurrentMetadata(record.Metadata)
	if err != nil {
		return Item{}, false, ErrCurrentIndexMetaInvalid
	}
	storedCollection, ok := metadata["collection"].(string)
	if !ok || storedCollection != collection {
		return Item{}, false, ErrCurrentIndexMetaInvalid
	}
	decodeCurrentNestedJSON(metadata, "index_configuration")
	return Item{
		ID:       record.ID,
		Metadata: metadata,
	}, true, nil
}
