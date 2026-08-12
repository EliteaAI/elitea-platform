package sqlcgen

import (
	"strings"
	"testing"
)

func TestCurrentAgentCancelSQLFencesTerminalJobsAndPreservesCurrentProjection(t *testing.T) {
	for _, fragment := range []string{
		"job.desired_state = 'RUNNING'",
		"'PENDING', 'DISPATCHED', 'CLAIMED', 'RUNNING', 'SETTLING'",
		"OR job.desired_state = 'CANCELLED'",
		"conversation.author_id = $3::bigint",
		"question_author.entity_meta ->> 'id'",
	} {
		if !strings.Contains(cancelCurrentAgentExecution, fragment) {
			t.Fatalf("cancellation SQL missing %q", fragment)
		}
	}
	for _, terminalState := range []string{"'SUCCEEDED'", "'FAILED'"} {
		if strings.Contains(cancelCurrentAgentExecution, "job.state IN ("+terminalState) {
			t.Fatalf("terminal state %s must not become cancelled", terminalState)
		}
	}
	for _, fragment := range []string{
		"job.actor_id = $3::bigint::text",
		"job.desired_state = 'CANCELLED'",
	} {
		if !strings.Contains(isCurrentAgentCancellationReplay, fragment) {
			t.Fatalf("replay SQL missing %q", fragment)
		}
	}
	for _, fragment := range []string{
		"SET is_streaming = FALSE",
		"- 'hitl_interrupt'",
		"- 'hitl_interrupts'",
		"- 'authorization_requests'",
		"trace.kind = 'thinking_step'",
		"INSERT INTO chat_messages_text",
		"DELETE FROM chat_message_items AS item",
		"DELETE FROM chat_message_group AS response",
		"DELETE FROM chat_message_group AS question",
	} {
		if !strings.Contains(projectCurrentAgentStop, fragment) {
			t.Fatalf("projection SQL missing %q", fragment)
		}
	}
}
