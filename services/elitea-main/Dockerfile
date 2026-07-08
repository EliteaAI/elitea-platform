# syntax=docker/dockerfile:1.7

# ── Stage 1: builder ──────────────────────────────────────────────────────────
FROM golang:1.23-alpine AS builder

WORKDIR /src

# Cache module downloads separately from source.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags="-s -w" -o /out/elitea-main ./cmd/elitea-main

# ── Stage 2: vulnerability scan ───────────────────────────────────────────────
FROM aquasec/trivy:latest AS scanner
COPY --from=builder /out/elitea-main /elitea-main
# Fail the build on HIGH/CRITICAL vulnerabilities in the binary.
RUN trivy rootfs --exit-code 1 --severity HIGH,CRITICAL --no-progress /

# ── Stage 3: final runtime image ──────────────────────────────────────────────
FROM gcr.io/distroless/static-debian12:nonroot AS final

COPY --from=builder /out/elitea-main /elitea-main

EXPOSE 8080

ENTRYPOINT ["/elitea-main"]
