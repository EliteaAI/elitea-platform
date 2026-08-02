package notifications

import "sync"

type currentNotificationAdmission struct {
	mu             sync.Mutex
	globalLimit    int
	principalLimit int
	active         int
	byPrincipal    map[string]int
}

func newCurrentNotificationAdmission(globalLimit, principalLimit int) *currentNotificationAdmission {
	if globalLimit <= 0 || principalLimit <= 0 || principalLimit > globalLimit {
		return nil
	}
	return &currentNotificationAdmission{
		globalLimit:    globalLimit,
		principalLimit: principalLimit,
		byPrincipal:    make(map[string]int),
	}
}

func (gate *currentNotificationAdmission) acquire(principalID string) (func(), bool) {
	if gate == nil || principalID == "" {
		return nil, false
	}
	gate.mu.Lock()
	if gate.active >= gate.globalLimit || gate.byPrincipal[principalID] >= gate.principalLimit {
		gate.mu.Unlock()
		return nil, false
	}
	gate.active++
	gate.byPrincipal[principalID]++
	gate.mu.Unlock()

	var once sync.Once
	return func() {
		once.Do(func() {
			gate.mu.Lock()
			gate.active--
			gate.byPrincipal[principalID]--
			if gate.byPrincipal[principalID] == 0 {
				delete(gate.byPrincipal, principalID)
			}
			gate.mu.Unlock()
		})
	}, true
}
