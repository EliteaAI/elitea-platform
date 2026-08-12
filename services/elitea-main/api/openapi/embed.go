// Package openapi embeds the hand-maintained v2.yaml spec into the binary so
// it can be served at runtime (GET /api/openapi.yaml) without depending on a
// filesystem layout in production images.
package openapi

import _ "embed"

//go:embed v2.yaml
var SpecYAML []byte
