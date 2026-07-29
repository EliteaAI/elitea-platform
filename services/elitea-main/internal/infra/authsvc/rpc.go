package authsvc

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/redis/go-redis/v9"
)

const (
	DefaultRPCTimeout = 2 * time.Second
	AuthCacheTTL      = 60 * time.Second
	requestChannel    = "pylon_auth:rpc:request"
)

type Client struct {
	redis      redis.UniversalClient
	rpcTimeout time.Duration
}

type Option func(*Client)

func WithRPCTimeout(d time.Duration) Option {
	return func(c *Client) { c.rpcTimeout = d }
}

func New(rdb redis.UniversalClient, opts ...Option) *Client {
	c := &Client{
		redis:      rdb,
		rpcTimeout: DefaultRPCTimeout,
	}
	for _, o := range opts {
		o(c)
	}
	return c
}

type rpcRequest struct {
	RequestID    string      `json:"request_id"`
	Method       string      `json:"method"`
	Payload      interface{} `json:"payload"`
	ReplyChannel string      `json:"reply_channel"`
}

type rpcResponse struct {
	RequestID string          `json:"request_id"`
	Success   bool            `json:"success"`
	Data      json.RawMessage `json:"data"`
	Error     string          `json:"error"`
}

type validateTokenPayload struct {
	Token string `json:"token"`
}

type validateTokenResponse struct {
	UserID      string   `json:"user_id"`
	TokenID     string   `json:"token_id"`
	Email       string   `json:"email"`
	Name        string   `json:"name"`
	Roles       []string `json:"roles"`
	Permissions []string `json:"permissions"`
}

func (c *Client) ValidateToken(ctx context.Context, token string) (auth.User, error) {
	reqID := generateRequestID()
	replyChannel := fmt.Sprintf("pylon_main:rpc:reply:%s", reqID)

	sub := c.redis.Subscribe(ctx, replyChannel)
	defer func() { _ = sub.Close() }()

	if _, err := sub.Receive(ctx); err != nil {
		return auth.User{}, fmt.Errorf("authsvc: subscribe failed: %w", err)
	}

	req := rpcRequest{
		RequestID:    reqID,
		Method:       "validate_token",
		Payload:      validateTokenPayload{Token: token},
		ReplyChannel: replyChannel,
	}

	reqBytes, err := json.Marshal(req)
	if err != nil {
		return auth.User{}, fmt.Errorf("authsvc: marshal failed: %w", err)
	}

	if err := c.redis.Publish(ctx, requestChannel, reqBytes).Err(); err != nil {
		return auth.User{}, fmt.Errorf("authsvc: publish failed: %w", err)
	}

	ch := sub.Channel()
	timeout := time.After(c.rpcTimeout)

	select {
	case msg := <-ch:
		var resp rpcResponse
		if err := json.Unmarshal([]byte(msg.Payload), &resp); err != nil {
			return auth.User{}, fmt.Errorf("authsvc: unmarshal response failed: %w", err)
		}
		if !resp.Success {
			return auth.User{}, errors.New("authsvc: " + resp.Error)
		}
		var data validateTokenResponse
		if err := json.Unmarshal(resp.Data, &data); err != nil {
			return auth.User{}, fmt.Errorf("authsvc: unmarshal data failed: %w", err)
		}
		return auth.User{
			ID:          data.UserID,
			UserID:      data.UserID,
			TokenID:     data.TokenID,
			Email:       data.Email,
			Name:        data.Name,
			Roles:       data.Roles,
			Permissions: data.Permissions,
			AuthType:    "token",
		}, nil
	case <-timeout:
		return auth.User{}, errors.New("authsvc: rpc timeout")
	case <-ctx.Done():
		return auth.User{}, ctx.Err()
	}
}

func (c *Client) GetCached(ctx context.Context, key string) (*auth.User, error) {
	val, err := c.redis.Get(ctx, key).Result()
	if err != nil {
		return nil, err
	}
	var user auth.User
	if err := json.Unmarshal([]byte(val), &user); err != nil {
		return nil, err
	}
	return &user, nil
}

func (c *Client) SetCached(ctx context.Context, key string, user auth.User) error {
	data, err := json.Marshal(user)
	if err != nil {
		return err
	}
	return c.redis.Set(ctx, key, data, AuthCacheTTL).Err()
}

func generateRequestID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
