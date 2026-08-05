package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/oauth2"
)

type OIDCConfig struct {
	IssuerURL    string
	ClientID     string
	ClientSecret string
	RedirectURI  string
}

func OIDCConfigFromEnv() (*OIDCConfig, error) {
	issuer := os.Getenv("OIDC_ISSUER_URL")
	if issuer == "" {
		return nil, nil
	}
	cfg := &OIDCConfig{
		IssuerURL:    issuer,
		ClientID:     os.Getenv("OIDC_CLIENT_ID"),
		ClientSecret: os.Getenv("OIDC_CLIENT_SECRET"),
		RedirectURI:  os.Getenv("OIDC_REDIRECT_URI"),
	}
	if cfg.ClientID == "" || cfg.RedirectURI == "" {
		return nil, fmt.Errorf("OIDC: OIDC_CLIENT_ID and OIDC_REDIRECT_URI are required when OIDC_ISSUER_URL is set")
	}
	return cfg, nil
}

type OIDCHandler struct {
	provider      *oidc.Provider
	verifier      *oidc.IDTokenVerifier
	oauth2Cfg     *oauth2.Config
	pool          *pgxpool.Pool
	secretKey     string
	secureCookies bool
}

func NewOIDCHandler(ctx context.Context, cfg *OIDCConfig, pool *pgxpool.Pool, secretKey string) (*OIDCHandler, error) {
	provider, err := oidc.NewProvider(ctx, cfg.IssuerURL)
	if err != nil {
		return nil, fmt.Errorf("OIDC discovery failed for %s: %w", cfg.IssuerURL, err)
	}

	oauth2Cfg := &oauth2.Config{
		ClientID:     cfg.ClientID,
		ClientSecret: cfg.ClientSecret,
		RedirectURL:  cfg.RedirectURI,
		Endpoint:     provider.Endpoint(),
		Scopes:       []string{oidc.ScopeOpenID, "profile", "email"},
	}

	verifier := provider.Verifier(&oidc.Config{ClientID: cfg.ClientID})

	// COOKIE_SECURE=false disables the Secure flag — useful for E2E stacks
	// that run over plain HTTP on localhost.
	secureCookies := os.Getenv("COOKIE_SECURE") != "false"

	return &OIDCHandler{
		provider:      provider,
		verifier:      verifier,
		oauth2Cfg:     oauth2Cfg,
		pool:          pool,
		secretKey:     secretKey,
		secureCookies: secureCookies,
	}, nil
}

func (h *OIDCHandler) Login(w http.ResponseWriter, r *http.Request) {
	targetTo := safeRedirectTarget(r.URL.Query().Get("target_to"))

	rawState := make([]byte, 16)
	if _, err := rand.Read(rawState); err != nil {
		http.Error(w, "failed to initialize OIDC state", http.StatusInternalServerError)
		return
	}
	stateNonce := base64.RawURLEncoding.EncodeToString(rawState)

	stateValue := stateNonce + "|" + targetTo

	mac := hmac.New(sha256.New, []byte(h.secretKey))
	mac.Write([]byte(stateValue))
	sig := hex.EncodeToString(mac.Sum(nil))
	cookieValue := stateValue + "." + sig

	http.SetCookie(w, &http.Cookie{
		Name:     "oidc_state",
		Value:    cookieValue,
		Path:     "/",
		HttpOnly: true,
		Secure:   h.secureCookies,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   300,
	})

	authURL := h.oauth2Cfg.AuthCodeURL(stateValue)
	http.Redirect(w, r, authURL, http.StatusFound)
}

func (h *OIDCHandler) Callback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	stateCookie, err := r.Cookie("oidc_state")
	if err != nil || stateCookie.Value == "" {
		http.Error(w, "missing state cookie", http.StatusBadRequest)
		return
	}

	parts := strings.SplitN(stateCookie.Value, ".", 2)
	if len(parts) != 2 {
		http.Error(w, "invalid state cookie", http.StatusBadRequest)
		return
	}

	storedState := parts[0]
	storedSig := parts[1]

	mac := hmac.New(sha256.New, []byte(h.secretKey))
	mac.Write([]byte(storedState))
	expectedSig := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(storedSig), []byte(expectedSig)) {
		http.Error(w, "state cookie signature invalid", http.StatusBadRequest)
		return
	}

	queryState := r.URL.Query().Get("state")
	if queryState != storedState {
		http.Error(w, "state mismatch", http.StatusBadRequest)
		return
	}

	// Clear the state cookie
	http.SetCookie(w, &http.Cookie{
		Name:     "oidc_state",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   h.secureCookies,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})

	// Extract target_to from state
	targetTo := "/"
	if idx := strings.Index(storedState, "|"); idx >= 0 {
		targetTo = safeRedirectTarget(storedState[idx+1:])
	}

	// Exchange authorization code for tokens
	code := r.URL.Query().Get("code")
	if code == "" {
		http.Error(w, "missing authorization code", http.StatusBadRequest)
		return
	}

	token, err := h.oauth2Cfg.Exchange(ctx, code)
	if err != nil {
		slog.Error("OIDC token exchange failed", "err", err)
		http.Error(w, "token exchange failed", http.StatusInternalServerError)
		return
	}

	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok {
		slog.Error("OIDC: no id_token in token response")
		http.Error(w, "no id_token in response", http.StatusInternalServerError)
		return
	}

	idToken, err := h.verifier.Verify(ctx, rawIDToken)
	if err != nil {
		slog.Error("OIDC: id_token verification failed", "err", err)
		http.Error(w, "id_token verification failed", http.StatusUnauthorized)
		return
	}

	var claims struct {
		Sub   string `json:"sub"`
		Email string `json:"email"`
		Name  string `json:"name"`
	}
	if err := idToken.Claims(&claims); err != nil {
		slog.Error("OIDC: failed to parse claims", "err", err)
		http.Error(w, "failed to parse claims", http.StatusInternalServerError)
		return
	}

	if claims.Email == "" {
		slog.Error("OIDC: no email in claims", "sub", claims.Sub)
		http.Error(w, "email claim required", http.StatusBadRequest)
		return
	}

	userID, err := h.provisionUser(ctx, claims.Sub, claims.Email, claims.Name)
	if err != nil {
		slog.Error("OIDC: user provisioning failed", "err", err, "email", claims.Email)
		http.Error(w, "user provisioning failed", http.StatusInternalServerError)
		return
	}

	sessionToken := makeSessionToken(h.secretKey, userID, claims.Email)
	http.SetCookie(w, &http.Cookie{
		Name:     "elitea_session",
		Value:    sessionToken,
		Path:     "/",
		HttpOnly: true,
		Secure:   h.secureCookies,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   86400,
	})

	slog.Info("OIDC login successful", "email", claims.Email, "user_id", userID)
	http.Redirect(w, r, targetTo, http.StatusFound)
}

func (h *OIDCHandler) provisionUser(ctx context.Context, sub, email, name string) (string, error) {
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var userID int
	err = tx.QueryRow(ctx,
		`INSERT INTO auth_core__user (email, name, last_login)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (email) DO UPDATE SET last_login = $3
		 RETURNING id`,
		email, name, time.Now(),
	).Scan(&userID)
	if err != nil {
		return "", fmt.Errorf("upsert user: %w", err)
	}

	providerRef := "oidc:" + sub
	_, err = tx.Exec(ctx,
		`INSERT INTO auth_core__user_provider (user_id, provider_ref)
		 VALUES ($1, $2)
		 ON CONFLICT DO NOTHING`,
		userID, providerRef,
	)
	if err != nil {
		return "", fmt.Errorf("link provider: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit: %w", err)
	}

	return fmt.Sprintf("%d", userID), nil
}
