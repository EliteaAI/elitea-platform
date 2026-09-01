// Package spi holds the provider SPI paths this service speaks.
//
// THE POINT IS THAT PRODUCTION CODE OWNS THEM. Before this package the paths
// were built by unexported helpers inside the DeepWiki facade, and the parity
// gate compared the frozen contract against those helpers — so the contract
// was checked against one provider's private implementation detail. A second
// facade would have written its own copy, and the gate would have kept passing
// while the two disagreed.
//
// The frozen contract is conformance/provider/spi/contract.json. It is the
// document; this is the code that speaks it, and
// internal/api/v2/deepwiki/spi_contract_parity_test.go fails when they drift.
//
// WHAT IS NOT HERE. /descriptor and /health are in the contract and have no
// builder, because nothing in this service calls them yet — they are consumed
// by the admission and health planes, which answer 501. Adding a builder for
// one is part of implementing it, and the parity gate's unserved-path list is
// what makes that a deliberate act rather than a drift.
package spi

import (
	"fmt"
	"net/url"
)

// SlotsPath is the provider's per-project capacity endpoint.
//
// A constant rather than a builder: it takes no arguments. The project is
// carried by the signed identity headers, not by the path — which is why the
// facade's own route has a {project_id} segment and this does not.
const SlotsPath = "/slots"

// InvokePath builds the path that starts one invocation.
//
// Segments are escaped individually. A toolkit or tool name containing a slash
// would otherwise address a different route entirely, and the provider's
// router would answer 404 for a name the platform considers valid.
func InvokePath(toolkit, tool string) string {
	return fmt.Sprintf("/tools/%s/%s/invoke",
		url.PathEscape(toolkit), url.PathEscape(tool))
}

// InvocationPath builds the path that reads or cancels one invocation.
func InvocationPath(toolkit, tool, invocation string) string {
	return fmt.Sprintf("/tools/%s/%s/invocations/%s",
		url.PathEscape(toolkit), url.PathEscape(tool), url.PathEscape(invocation))
}
