// Package bifrostlog adapts Go's log/slog to bifrost/core's schemas.Logger
// interface.
//
// design-bifrost-gateway §6.1: bifrost.Init mutates the zerolog *global*
// logger when no config.Logger is supplied. The gateway standardises on
// slog + OTel, so a Logger MUST be injected into BifrostConfig.Logger — never
// call Init with a nil logger, or the process-wide logger is silently
// overwritten by zerolog.
package bifrostlog

import (
	"context"
	"log/slog"

	"github.com/maximhq/bifrost/core/schemas"
)

// Adapter implements schemas.Logger by forwarding to an *slog.Logger.
type Adapter struct {
	logger *slog.Logger
	level  *slog.LevelVar
}

// Compile-time assertion that Adapter satisfies bifrost's Logger contract.
var _ schemas.Logger = (*Adapter)(nil)

// New wraps an *slog.Logger as a bifrost schemas.Logger. The returned
// adapter's level is mutable via SetLevel; the initial level is taken from
// the provided *slog.LevelVar (which the slog handler must also observe).
func New(logger *slog.Logger, level *slog.LevelVar) *Adapter {
	return &Adapter{logger: logger, level: level}
}

func (a *Adapter) Debug(msg string, args ...any) { a.logger.Debug(msg, args...) }
func (a *Adapter) Info(msg string, args ...any)  { a.logger.Info(msg, args...) }
func (a *Adapter) Warn(msg string, args ...any)  { a.logger.Warn(msg, args...) }
func (a *Adapter) Error(msg string, args ...any) { a.logger.Error(msg, args...) }

// Fatal logs at error level. Unlike bifrost's DefaultLogger, this adapter does
// NOT call os.Exit: the gateway owns its own process lifecycle (graceful
// shutdown, liveness-probe restart) and must not let a library log call abort
// the process out from under an in-flight stream drain.
func (a *Adapter) Fatal(msg string, args ...any) {
	a.logger.Error(msg, append([]any{"fatal", true}, args...)...)
}

// SetLevel maps bifrost's LogLevel onto the shared slog LevelVar so the change
// is observed by the underlying slog handler.
func (a *Adapter) SetLevel(level schemas.LogLevel) {
	if a.level == nil {
		return
	}
	switch level {
	case schemas.LogLevelDebug:
		a.level.Set(slog.LevelDebug)
	case schemas.LogLevelInfo:
		a.level.Set(slog.LevelInfo)
	case schemas.LogLevelWarn:
		a.level.Set(slog.LevelWarn)
	case schemas.LogLevelError:
		a.level.Set(slog.LevelError)
	}
}

// SetOutputType is a no-op: slog output formatting is fixed at handler
// construction and is not switchable per bifrost's JSON/pretty toggle.
func (a *Adapter) SetOutputType(schemas.LoggerOutputType) {}

// LogHTTPRequest returns a fluent builder that accumulates typed fields and
// emits a single slog record on Send().
func (a *Adapter) LogHTTPRequest(level schemas.LogLevel, msg string) schemas.LogEventBuilder {
	return &eventBuilder{
		logger: a.logger,
		level:  slogLevel(level),
		msg:    msg,
		attrs:  make([]slog.Attr, 0, 8),
	}
}

func slogLevel(level schemas.LogLevel) slog.Level {
	switch level {
	case schemas.LogLevelDebug:
		return slog.LevelDebug
	case schemas.LogLevelWarn:
		return slog.LevelWarn
	case schemas.LogLevelError:
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

// eventBuilder implements schemas.LogEventBuilder over slog attributes.
type eventBuilder struct {
	logger *slog.Logger
	level  slog.Level
	msg    string
	attrs  []slog.Attr
}

func (e *eventBuilder) Str(key, val string) schemas.LogEventBuilder {
	e.attrs = append(e.attrs, slog.String(key, val))
	return e
}

func (e *eventBuilder) Int(key string, val int) schemas.LogEventBuilder {
	e.attrs = append(e.attrs, slog.Int(key, val))
	return e
}

func (e *eventBuilder) Int64(key string, val int64) schemas.LogEventBuilder {
	e.attrs = append(e.attrs, slog.Int64(key, val))
	return e
}

func (e *eventBuilder) Send() {
	e.logger.LogAttrs(context.Background(), e.level, e.msg, e.attrs...)
}
