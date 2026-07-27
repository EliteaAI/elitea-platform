package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"io"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/cutover"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/repos"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/runtimecomposition"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/transport/redisdispatch"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	exitReady        = 0
	exitBlocked      = 1
	exitInvalidUsage = 2
	preflightTimeout = 30 * time.Second
)

type stringList []string

func (values *stringList) String() string {
	return ""
}

func (values *stringList) Set(value string) error {
	*values = append(*values, value)
	return nil
}

func main() {
	signalContext, stop := signal.NotifyContext(
		context.Background(),
		os.Interrupt,
		syscall.SIGTERM,
	)
	defer stop()
	os.Exit(run(signalContext, os.Args[1:], os.LookupEnv, os.Stdout, os.Stderr))
}

func run(
	parent context.Context,
	arguments []string,
	lookup runtimecomposition.LookupEnv,
	stdout io.Writer,
	stderr io.Writer,
) int {
	if parent == nil || lookup == nil || stdout == nil || stderr == nil {
		return exitInvalidUsage
	}
	spoolRoots, ok := parseArguments(arguments)
	if !ok {
		writeMessage(stderr, "usage: index-v2-preflight --spool-root <absolute-private-directory> [--spool-root ...]\n")
		return exitInvalidUsage
	}
	runtimeConfig, err := runtimecomposition.ConfigFromEnv(lookup)
	if err != nil || !runtimeConfig.Enabled || !runtimeConfig.IndexIngestDispatchEnabled {
		writeMessage(stderr, "runtime index cutover configuration is invalid\n")
		return exitBlocked
	}
	databaseURL, exists := lookup("DATABASE_URL")
	if !exists || databaseURL == "" {
		writeMessage(stderr, "runtime index cutover database configuration is unavailable\n")
		return exitBlocked
	}

	ctx, cancel := context.WithTimeout(parent, preflightTimeout)
	defer cancel()

	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		writeMessage(stderr, "runtime index cutover database configuration is invalid\n")
		return exitBlocked
	}
	poolConfig.MaxConns = 2
	poolConfig.MinConns = 0
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		writeMessage(stderr, "runtime index cutover database is unavailable\n")
		return exitBlocked
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		writeMessage(stderr, "runtime index cutover database is unavailable\n")
		return exitBlocked
	}

	redisClient, err := runtimecomposition.NewControlRedisClient(ctx, runtimeConfig)
	if err != nil {
		writeMessage(stderr, "runtime index cutover control store is unavailable\n")
		return exitBlocked
	}
	defer func() {
		_ = redisClient.Close()
	}()

	persisted, err := repos.NewCurrentIndexV2CutoverRepository(pool)
	if err != nil {
		writeMessage(stderr, "runtime index cutover persisted-state reader is unavailable\n")
		return exitBlocked
	}
	control, err := redisdispatch.NewIndexV2CutoverReader(
		redisClient,
		runtimeConfig.IndexIngestCommandStream,
		runtimeConfig.IndexIngestConsumerGroup,
	)
	if err != nil {
		writeMessage(stderr, "runtime index cutover control-state reader is unavailable\n")
		return exitBlocked
	}
	preflight, err := cutover.NewIndexV2Preflight(persisted, control, spoolRoots)
	if err != nil {
		writeMessage(stderr, "runtime index cutover spool coverage is invalid\n")
		return exitBlocked
	}
	report, err := preflight.Check(ctx)
	if err != nil {
		if errors.Is(err, cutover.ErrIndexV2CutoverBlocked) {
			if encodeErr := json.NewEncoder(stdout).Encode(report); encodeErr != nil {
				writeMessage(stderr, "runtime index cutover report could not be written\n")
				return exitBlocked
			}
			writeMessage(stderr, "runtime index capability v2 cutover is blocked\n")
			return exitBlocked
		}
		writeMessage(stderr, "runtime index cutover dependency check failed\n")
		return exitBlocked
	}
	if err := json.NewEncoder(stdout).Encode(report); err != nil {
		writeMessage(stderr, "runtime index cutover report could not be written\n")
		return exitBlocked
	}
	return exitReady
}

func parseArguments(arguments []string) ([]string, bool) {
	flags := flag.NewFlagSet("index-v2-preflight", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	var roots stringList
	flags.Var(&roots, "spool-root", "absolute private output-spool root for one worker replica")
	if err := flags.Parse(arguments); err != nil || flags.NArg() != 0 || len(roots) == 0 {
		return nil, false
	}
	return []string(roots), true
}

func writeMessage(writer io.Writer, message string) {
	_, _ = io.WriteString(writer, message)
}
