module github.com/EliteaAI/elitea-platform/services/elitea-scheduler

go 1.25.0

replace github.com/EliteaAI/elitea-platform/libs/go/observability => ../../libs/go/observability

require (
	github.com/EliteaAI/elitea-platform/libs/go/observability v0.0.0
	github.com/jackc/pgx/v5 v5.7.1
	github.com/nats-io/nats.go v1.52.0
	github.com/redis/go-redis/v9 v9.7.0
	github.com/robfig/cron/v3 v3.0.1
	go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp v0.67.0
)

require (
	github.com/cespare/xxhash/v2 v2.3.0 // indirect
	github.com/dgryski/go-rendezvous v0.0.0-20200823014737-9f7001d12a5f // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	github.com/klauspost/compress v1.18.5 // indirect
	github.com/nats-io/nkeys v0.4.15 // indirect
	github.com/nats-io/nuid v1.0.1 // indirect
	golang.org/x/crypto v0.50.0 // indirect
	golang.org/x/sync v0.20.0 // indirect
	golang.org/x/sys v0.43.0 // indirect
	golang.org/x/text v0.36.0 // indirect
)
