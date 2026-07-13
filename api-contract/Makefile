.PHONY: install generate lint breaking clean

# Install required tools
install:
	go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
	go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
	go install github.com/grpc-ecosystem/grpc-gateway/v2/protoc-gen-grpc-gateway@latest
	go install github.com/bufbuild/buf/cmd/buf@latest

# Generate Go code from proto files using buf
generate:
	buf generate

# Run buf lint on all proto files
lint:
	buf lint

# Check for breaking changes against the main branch
breaking:
	buf breaking --against '.git#branch=main'

# Remove generated code
clean:
	rm -rf gen/
