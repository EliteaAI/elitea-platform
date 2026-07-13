package oapiserver

import (
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/generated"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/analytics"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/conversations"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/folders"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/skills"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/tags"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/applications"
	domainconv "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/conversations"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/predict"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Server struct {
	generated.Unimplemented

	pool          *pgxpool.Pool
	appsRepo      applications.Repository
	skillsRepo    skills.Repository
	foldersRepo   folders.Repository
	tagsRepo      tags.Repository
	convsRepo     conversations.Repository
	analyticsRepo analytics.Repository

	predictor    predict.Predictor
	pipeRunner   predict.PipelineRunner
	chatSvc      domainconv.ChatService
	artifactsDir string
}

type Config struct {
	Pool          *pgxpool.Pool
	AppsRepo      applications.Repository
	SkillsRepo    skills.Repository
	FoldersRepo   folders.Repository
	TagsRepo      tags.Repository
	ConvsRepo     conversations.Repository
	AnalyticsRepo analytics.Repository

	Predictor    predict.Predictor
	PipeRunner   predict.PipelineRunner
	ChatSvc      domainconv.ChatService
	ArtifactsDir string
}

func New(cfg Config) *Server {
	artifactsDir := cfg.ArtifactsDir
	if artifactsDir == "" {
		artifactsDir = "/data/artifacts"
	}
	return &Server{
		pool:          cfg.Pool,
		appsRepo:      cfg.AppsRepo,
		skillsRepo:    cfg.SkillsRepo,
		foldersRepo:   cfg.FoldersRepo,
		tagsRepo:      cfg.TagsRepo,
		convsRepo:     cfg.ConvsRepo,
		analyticsRepo: cfg.AnalyticsRepo,
		predictor:     cfg.Predictor,
		pipeRunner:    cfg.PipeRunner,
		chatSvc:       cfg.ChatSvc,
		artifactsDir:  artifactsDir,
	}
}

var _ generated.ServerInterface = (*Server)(nil)
