package scheduler

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

const lockTTL = 90 * time.Second

// Lock implements a Redis-based distributed lock using SETNX.
type Lock struct {
	rdb        *redis.Client
	key        string
	instanceID string
}

func newLock(rdb *redis.Client, jobName, instanceID string) *Lock {
	return &Lock{
		rdb:        rdb,
		key:        "elitea-scheduler:lock:" + jobName,
		instanceID: instanceID,
	}
}

// TryAcquire attempts to acquire the lock. Returns true if successful.
func (l *Lock) TryAcquire(ctx context.Context) (bool, error) {
	return l.rdb.SetNX(ctx, l.key, l.instanceID, lockTTL).Result()
}

// Release releases the lock only if we still own it (atomic Lua script).
func (l *Lock) Release(ctx context.Context) error {
	script := redis.NewScript(`
		if redis.call("GET", KEYS[1]) == ARGV[1] then
			return redis.call("DEL", KEYS[1])
		end
		return 0
	`)
	return script.Run(ctx, l.rdb, []string{l.key}, l.instanceID).Err()
}
