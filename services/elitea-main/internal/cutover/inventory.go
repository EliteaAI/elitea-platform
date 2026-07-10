package cutover

import "context"

var DefaultEndpoints = []string{
	"/api/v2/projects/{projectID}/applications",
	"/api/v2/projects/{projectID}/applications/{id}",
	"/api/v2/projects/{projectID}/skills",
	"/api/v2/projects/{projectID}/skills/{id}",
	"/api/v2/projects/{projectID}/folders",
	"/api/v2/projects/{projectID}/folders/{id}",
	"/api/v2/projects/{projectID}/tags",
	"/api/v2/projects/{projectID}/analytics",
	"/api/v2/projects/{projectID}/analytics/agents",
	"/api/v2/projects/{projectID}/analytics/tools",
	"/api/v2/projects/{projectID}/analytics/users",
	"/api/v2/projects/{projectID}/conversations",
	"/api/v2/projects/{projectID}/conversations/{id}",
	"/api/v2/projects/{projectID}/conversations/{id}/messages",
	"/api/v2/projects/{projectID}/webhooks",
	"/api/v2/projects/{projectID}/webhooks/{id}",
	"/api/v2/projects/{projectID}/events",
	"/api/v2/projects/{projectID}/predict",
	"/api/v2/projects/{projectID}/predict/llm",
	"/api/v2/projects/{projectID}/chat/{id}/messages",
	"/api/v2/projects/{projectID}/pipelines/run",
	"/api/v2/projects/{projectID}/pipelines/{id}/status",
	"/api/v2/projects/{projectID}/pipelines/{id}/cancel",
}

func (t *Tracker) SeedDefaults(ctx context.Context) error {
	for _, ep := range DefaultEndpoints {
		_, err := t.redis.HGet(ctx, redisKey, ep).Result()
		if err != nil {
			if err := t.Set(ctx, ep, StateLegacy, "seed"); err != nil {
				return err
			}
		}
	}
	return nil
}
