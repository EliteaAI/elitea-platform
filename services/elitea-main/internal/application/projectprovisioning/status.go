package projectprovisioning

// StepStatus is one step's outcome.
//
// The field set and the JSON names are legacy/plugins/projects/utils/helpers.py's
// `ProjectCreationStep.status` dict, which AdminAPI.post returns verbatim:
//
//	{'initialized': bool, 'ok': None|True|False, 'msg': str, 'step': <name>}
//
// `OK` is a pointer because the reference distinguishes three states, not two:
// null means the step never ran. Encoding it as a bare bool would report a step
// that was never reached as one that failed.
type StepStatus struct {
	Step        string `json:"step"`
	Initialized bool   `json:"initialized"`
	OK          *bool  `json:"ok"`
	Msg         string `json:"msg"`
}

func (s *StepStatus) setOK() {
	value := true
	s.OK = &value
	s.Msg = ""
}

// setFailed records a failure with a caller-safe message.
//
// The reference puts `str(exception)` here, which sends a raw database error
// across a trust boundary. AGENTS.md forbids that; the cause is logged with the
// project id instead, and the step name — the part a caller can act on — is
// preserved.
func (s *StepStatus) setFailed(message string) {
	value := false
	s.OK = &value
	s.Msg = message
}
