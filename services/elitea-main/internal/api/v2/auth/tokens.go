package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	identity "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

const (
	maxTokenRequestBodyBytes = 4 << 10
	maxTokenNameBytes        = 768
)

var (
	errTokenNotFound  = errors.New("token not found")
	errTokenForbidden = errors.New("token belongs to another user")
)

type Token struct {
	ID      int64      `json:"id"`
	UUID    string     `json:"uuid"`
	Expires *time.Time `json:"expires"`
	UserID  int64      `json:"user_id"`
	Name    string     `json:"name"`
	Token   string     `json:"token"`
}

type tokenRecord struct {
	ID      int64
	UUID    string
	Expires *time.Time
	UserID  int64
	Name    string
}

type tokenRepository interface {
	List(context.Context, int64) ([]tokenRecord, error)
	GetOwned(context.Context, int64, string) (tokenRecord, error)
	Create(context.Context, int64, string, *time.Time) (tokenRecord, error)
	DeleteOwned(context.Context, int64, string) error
}

type postgresTokenRepository struct {
	pool    *pgxpool.Pool
	queries *sqlcgen.Queries
}

func newPostgresTokenRepository(pool *pgxpool.Pool) *postgresTokenRepository {
	return &postgresTokenRepository{
		pool:    pool,
		queries: sqlcgen.New(pool),
	}
}

func (r *postgresTokenRepository) List(ctx context.Context, userID int64) ([]tokenRecord, error) {
	databaseUserID, err := patDatabaseID(userID)
	if err != nil {
		return nil, err
	}
	rows, err := r.queries.ListOwnedPATs(ctx, databaseUserID)
	if err != nil {
		return nil, err
	}
	records := make([]tokenRecord, 0, len(rows))
	for _, row := range rows {
		record, err := patRecord(row.ID, row.Uuid, row.Expires, row.UserID, row.Name)
		if err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	return records, nil
}

func (r *postgresTokenRepository) GetOwned(ctx context.Context, userID int64, tokenUUID string) (tokenRecord, error) {
	databaseUserID, err := patDatabaseID(userID)
	if err != nil {
		return tokenRecord{}, err
	}
	row, err := r.queries.GetOwnedPAT(ctx, sqlcgen.GetOwnedPATParams{
		Uuid:   tokenUUID,
		UserID: databaseUserID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return tokenRecord{}, errTokenNotFound
	}
	if err != nil {
		return tokenRecord{}, err
	}
	return patRecord(row.ID, row.Uuid, row.Expires, row.UserID, row.Name)
}

func (r *postgresTokenRepository) Create(ctx context.Context, userID int64, name string, expires *time.Time) (tokenRecord, error) {
	databaseUserID, err := patDatabaseID(userID)
	if err != nil {
		return tokenRecord{}, err
	}
	tokenUUID, err := generateUUID()
	if err != nil {
		return tokenRecord{}, err
	}
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return tokenRecord{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	row, err := r.queries.WithTx(tx).CreatePATForActiveUser(
		ctx,
		sqlcgen.CreatePATForActiveUserParams{
			Uuid:    tokenUUID,
			Expires: patDatabaseTimestamp(expires),
			Name:    name,
			UserID:  databaseUserID,
		},
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return tokenRecord{}, errTokenForbidden
	}
	if err != nil {
		return tokenRecord{}, err
	}
	record, err := patRecord(row.ID, row.Uuid, row.Expires, row.UserID, row.Name)
	if err != nil {
		return tokenRecord{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return tokenRecord{}, err
	}
	return record, nil
}

func (r *postgresTokenRepository) DeleteOwned(ctx context.Context, userID int64, tokenUUID string) error {
	databaseUserID, err := patDatabaseID(userID)
	if err != nil {
		return err
	}
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	queries := r.queries.WithTx(tx)
	locked, err := queries.LockPATByUUID(ctx, tokenUUID)
	if errors.Is(err, pgx.ErrNoRows) {
		return errTokenNotFound
	}
	if err != nil {
		return err
	}
	if locked.UserID != databaseUserID {
		return errTokenForbidden
	}
	deleted, err := queries.DeletePATByID(ctx, locked.ID)
	if err != nil {
		return err
	}
	if deleted != 1 {
		return fmt.Errorf("delete PAT: affected %d rows, want 1", deleted)
	}
	return tx.Commit(ctx)
}

func patDatabaseID(id int64) (int32, error) {
	if id <= 0 || id > math.MaxInt32 {
		return 0, fmt.Errorf("PAT owner ID is outside the baseline integer range")
	}
	return int32(id), nil
}

func patDatabaseTimestamp(value *time.Time) pgtype.Timestamp {
	if value == nil {
		return pgtype.Timestamp{}
	}
	return pgtype.Timestamp{Time: *value, Valid: true}
}

func patRecord(
	id int32,
	uuid string,
	expires pgtype.Timestamp,
	userID int32,
	name string,
) (tokenRecord, error) {
	if id <= 0 || userID <= 0 || !validTokenUUID(uuid) {
		return tokenRecord{}, errors.New("PAT row contains invalid identity data")
	}
	var expiration *time.Time
	if expires.Valid {
		value := expires.Time
		expiration = &value
	}
	return tokenRecord{
		ID:      int64(id),
		UUID:    uuid,
		Expires: expiration,
		UserID:  int64(userID),
		Name:    name,
	}, nil
}

func (h *Handler) TokenList(w http.ResponseWriter, r *http.Request) {
	ownerID, ok := tokenOwnerID(r)
	if !ok {
		apierr.Write(w, apierr.Unauthorized("not authenticated"))
		return
	}
	if !h.tokenServiceAvailable(w) {
		return
	}
	records, err := h.tokens.List(r.Context(), ownerID)
	if err != nil {
		apierr.Write(w, apierr.Internal("failed to list tokens"))
		return
	}
	tokens := make([]Token, 0, len(records))
	for _, record := range records {
		token, err := h.presentToken(record, false)
		if err != nil {
			apierr.Write(w, apierr.Internal("failed to encode token metadata"))
			return
		}
		tokens = append(tokens, token)
	}
	writeJSON(w, http.StatusOK, tokens)
}

func (h *Handler) TokenGet(w http.ResponseWriter, r *http.Request) {
	ownerID, ok := tokenOwnerID(r)
	if !ok {
		apierr.Write(w, apierr.Unauthorized("not authenticated"))
		return
	}
	if !h.tokenServiceAvailable(w) {
		return
	}
	tokenUUID := chi.URLParam(r, "tokenUUID")
	if !validTokenUUID(tokenUUID) {
		apierr.Write(w, apierr.BadRequest("invalid token UUID"))
		return
	}
	record, err := h.tokens.GetOwned(r.Context(), ownerID, tokenUUID)
	if errors.Is(err, errTokenNotFound) {
		apierr.Write(w, apierr.BadRequest("token not found"))
		return
	}
	if err != nil {
		apierr.Write(w, apierr.Internal("failed to get token"))
		return
	}
	token, err := h.presentToken(record, false)
	if err != nil {
		apierr.Write(w, apierr.Internal("failed to encode token metadata"))
		return
	}
	writeJSON(w, http.StatusOK, token)
}

type tokenCreateRequest struct {
	Name    *string          `json:"name"`
	Expires *tokenExpiration `json:"expires"`
}

type tokenExpiration struct {
	Measure string `json:"measure"`
	Value   *int64 `json:"value"`
}

func (h *Handler) TokenCreate(w http.ResponseWriter, r *http.Request) {
	ownerID, ok := tokenOwnerID(r)
	if !ok {
		apierr.Write(w, apierr.Unauthorized("not authenticated"))
		return
	}
	if !h.tokenServiceAvailable(w) {
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxTokenRequestBodyBytes)
	var request tokenCreateRequest
	if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}
	if request.Name == nil {
		apierr.Write(w, apierr.BadRequest("Name is required"))
		return
	}
	name := *request.Name
	if len(name) > maxTokenNameBytes {
		apierr.Write(w, apierr.BadRequest("invalid token name"))
		return
	}
	expires, err := request.Expires.resolve(time.Now().UTC())
	if err != nil {
		apierr.Write(w, apierr.BadRequest(err.Error()))
		return
	}
	record, err := h.tokens.Create(r.Context(), ownerID, name, expires)
	if errors.Is(err, errTokenForbidden) {
		apierr.Write(w, apierr.Unauthorized("authenticated principal is inactive"))
		return
	}
	if err != nil {
		apierr.Write(w, apierr.Internal("failed to create token"))
		return
	}
	token, err := h.presentToken(record, true)
	if err != nil {
		apierr.Write(w, apierr.Internal("failed to encode token"))
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	writeJSON(w, http.StatusOK, token)
}

func (h *Handler) TokenDelete(w http.ResponseWriter, r *http.Request) {
	ownerID, ok := tokenOwnerID(r)
	if !ok {
		apierr.Write(w, apierr.Unauthorized("not authenticated"))
		return
	}
	if !h.tokenServiceAvailable(w) {
		return
	}
	tokenUUID := chi.URLParam(r, "tokenUUID")
	if !validTokenUUID(tokenUUID) {
		apierr.Write(w, apierr.BadRequest("invalid token UUID"))
		return
	}
	err := h.tokens.DeleteOwned(r.Context(), ownerID, tokenUUID)
	switch {
	case errors.Is(err, errTokenNotFound):
		apierr.Write(w, apierr.BadRequest("token not found"))
	case errors.Is(err, errTokenForbidden):
		apierr.Write(w, apierr.Forbidden("token belongs to another user"))
	case err != nil:
		apierr.Write(w, apierr.Internal("failed to delete token"))
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

func tokenOwnerID(r *http.Request) (int64, bool) {
	user, ok := identity.UserFromContext(r.Context())
	if !ok {
		return 0, false
	}
	return user.OwningUserID()
}

func (h *Handler) tokenServiceAvailable(w http.ResponseWriter) bool {
	if h.tokens != nil && len(h.tokenSigningKey) != 0 {
		return true
	}
	http.Error(w, `{"error":"token service is not configured"}`, http.StatusServiceUnavailable)
	return false
}

func (h *Handler) presentToken(record tokenRecord, reveal bool) (Token, error) {
	encoded, err := signBaselineToken(h.tokenSigningKey, record)
	if err != nil {
		return Token{}, err
	}
	if !reveal {
		encoded = "..." + encoded[len(encoded)-7:]
	}
	return Token{
		ID:      record.ID,
		UUID:    record.UUID,
		Expires: record.Expires,
		UserID:  record.UserID,
		Name:    record.Name,
		Token:   encoded,
	}, nil
}

type baselineTokenClaims struct {
	UUID    string  `json:"uuid"`
	Expires *string `json:"expires"`
	jwt.RegisteredClaims
}

func signBaselineToken(secret []byte, record tokenRecord) (string, error) {
	if len(secret) == 0 {
		return "", errors.New("token signing key is empty")
	}
	var expires *string
	if record.Expires != nil {
		value := record.Expires.Format("2006-01-02T15:04")
		expires = &value
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS512, baselineTokenClaims{
		UUID:    record.UUID,
		Expires: expires,
	})
	return token.SignedString(secret)
}

func (expiration *tokenExpiration) resolve(now time.Time) (*time.Time, error) {
	if expiration == nil {
		return nil, nil
	}
	if expiration.Value == nil {
		return nil, errors.New("expires must have value")
	}
	unit, ok := map[string]time.Duration{
		"seconds": time.Second,
		"minutes": time.Minute,
		"hours":   time.Hour,
		"days":    24 * time.Hour,
		"weeks":   7 * 24 * time.Hour,
	}[expiration.Measure]
	if !ok {
		return nil, errors.New("invalid expires measure")
	}
	unitValue := int64(unit)
	if *expiration.Value > math.MaxInt64/unitValue || *expiration.Value < math.MinInt64/unitValue {
		return nil, errors.New("expires value is out of range")
	}
	result := now.Add(time.Duration(*expiration.Value * unitValue))
	return &result, nil
}

func validTokenUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for index, char := range value {
		if index == 8 || index == 13 || index == 18 || index == 23 {
			if char != '-' {
				return false
			}
			continue
		}
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F')) {
			return false
		}
	}
	return true
}
