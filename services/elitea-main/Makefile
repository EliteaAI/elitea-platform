.PHONY: build test lint run docker-build sqlc generate openapi

MODULE := github.com/EliteaAI/elitea-platform/services/elitea-main
BINARY := elitea-main
IMAGE  := eliteaai/elitea-main

build:
	go build -o bin/$(BINARY) ./cmd/$(BINARY)

test:
	go test -race -count=1 ./...

lint:
	golangci-lint run ./...

run:
	go run ./cmd/$(BINARY)

docker-build:
	docker build -t $(IMAGE):dev .

sqlc:
	sqlc generate

vet:
	go vet ./...

openapi:
	@mkdir -p internal/api/generated
	oapi-codegen --config api/openapi/oapi-codegen.yaml api/openapi/v2.yaml

generate: sqlc openapi
