package spi

// Slots is the provider's capacity report — the frozen body, with both
// spellings of can_start because the recording carried both.
//
// Jobs mode (SLOTS_MODE on) is refused rather than reported: this host runs
// no Kubernetes Jobs, so its capacity there is unknown, and a body that
// said "3 available" would start generations nothing can run.
func Slots(s Settings, active int) map[string]any {
	if s.JobsEnabled {
		return map[string]any{
			"available": 0,
			"total":     s.MaxConcurrentJobs,
			"active":    0,
			"can_start": false,
			"canStart":  false,
			"mode":      "jobs",
			"namespace": s.Namespace,
			"error": "Kubernetes Jobs mode is configured but not implemented in this " +
				"build; capacity is unknown, so no generation may start.",
		}
	}
	total := s.MaxParallelWorkers
	available := total - active
	if available < 0 {
		available = 0
	}
	return map[string]any{
		"available": available,
		"total":     total,
		"active":    active,
		"can_start": active < total,
		"canStart":  active < total,
		"mode":      "subprocess",
		"note":      "Per-pod availability only (subprocess mode)",
	}
}
