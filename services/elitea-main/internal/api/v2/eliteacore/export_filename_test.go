package eliteacore

import (
	"fmt"
	"mime"
	"path"
	"strings"
	"testing"
)

// The export filename is built from `entityID`, which arrives in the URL. The
// JSON branch of ExportImportGet built the header with a plain Sprintf into a
// quoted string, where the markdown branch beside it already used
// contentDispositionAttachment and path.Base. CodeQL names this parameter as
// the source of go/reflected-xss alerts 100 and 101.
//
// # What this test asserts, and why it is not a character check
//
// The property is NOT "the filename holds only safe characters".
// `contentDispositionAttachment` deliberately keeps `;`, `=`, `<`, `>` and the
// space: inside a quoted string those are literal text, and a client reads
// them as part of the name. Only `"` and `\` can end the quoting, and only a
// control character can end the header, so those are the ones it replaces.
//
// The property IS "a client parses one attachment with one filename, whatever
// the caller sent". So parse the header the way a client does, with
// mime.ParseMediaType, and assert the RESULT. Two earlier drafts of this test
// did not discriminate:
//
//   - Checking the text between the first pair of quotes passes for
//     `1"; x="`, because the caller's own quote BECOMES the closing quote. The
//     region then reads as a clean `elitea_export_1` while the header has
//     grown a second parameter.
//   - Matching the whole header against a narrow character class fails the
//     FIXED code, because the sanitiser keeps the harmless characters above.
//
// A test that passes against the defect it exists to catch is worth nothing.
func TestExportFilenameCannotLeaveTheQuotedHeader(t *testing.T) {
	t.Parallel()

	hostile := []struct {
		name     string
		entityID string
	}{
		{"a quote closes the filename", `1"; x="`},
		{"a quote and a second parameter", `1"; attachment; filename="evil.html`},
		{"a backslash escapes the quote", `1\"`},
		{"a header break", "1\r\nX-Injected: yes"},
		{"a newline alone", "1\nX-Injected: yes"},
		{"a path escapes the name", "../../etc/passwd"},
		{"a path with a quote", `../..\"/etc/passwd`},
		{"a control character", "1\x00\x07"},
		{"a script tag", `1<script>alert(1)</script>`},
		{"an html extension", `1.html`},
	}

	for _, testCase := range hostile {
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()

			// The handler now REFUSES a non-decimal entityID with 404 before it
			// reaches this header (see ExportImportGet). This asserts the
			// defence that remains if that guard is ever removed: even handed
			// the hostile value, the header a client parses holds one
			// attachment and one filename.
			header := contentDispositionAttachment(
				fmt.Sprintf("elitea_export_%s.json", path.Base(testCase.entityID)))

			// A control character ends a header on the wire, so none may survive.
			for _, forbidden := range []string{"\r", "\n", "\x00"} {
				if strings.Contains(header, forbidden) {
					t.Fatalf("header carries %q: %q", forbidden, header)
				}
			}

			// Parse it the way a client does. This is the assertion that
			// discriminates: an escaped quote yields a SECOND parameter here.
			disposition, params, err := mime.ParseMediaType(header)
			if err != nil {
				t.Fatalf("client cannot parse the header %q: %v", header, err)
			}
			if disposition != "attachment" {
				t.Fatalf("disposition = %q, want attachment (header %q)", disposition, header)
			}

			// Only the filename parameters may be present. `1"; x="` produced a
			// stray `x` before the fix, and that is the injection.
			for name := range params {
				if name != "filename" && name != "filename*" {
					t.Fatalf("header grew a %q parameter, so caller text escaped the quoting: %q", name, header)
				}
			}

			// Read the ASCII `filename`, not mime's preferred `filename*`.
			// RFC 5987 percent-encodes its value, so `filename*` legitimately
			// carries the raw name and cannot break the header; the ASCII
			// parameter is the one a client without RFC 5987 support reads,
			// and the one contentDispositionAttachment cleans.
			filename := asciiFilename(header)
			if !strings.HasPrefix(filename, "elitea_export_") {
				t.Fatalf("filename = %q, want the elitea_export_ prefix (header %q)", filename, header)
			}
			if !strings.HasSuffix(filename, ".json") {
				t.Fatalf("filename = %q, want a .json suffix — a caller must not choose the extension (header %q)", filename, header)
			}
			if strings.ContainsAny(filename, `/\"`) {
				t.Fatalf("filename = %q holds a separator or a quote (header %q)", filename, header)
			}
		})
	}
}

// A plain numeric id, which is what the UI sends, must still produce the exact
// filename it produced before. The fix must not change the normal case.
func TestExportFilenameIsUnchangedForARealID(t *testing.T) {
	t.Parallel()

	header := contentDispositionAttachment(
		fmt.Sprintf("elitea_export_%s.json", path.Base("42")))

	if want := `attachment; filename="elitea_export_42.json"`; header != want {
		t.Errorf("header = %q, want %q", header, want)
	}
}

// asciiFilename reads the plain `filename` parameter out of the header.
// mime.ParseMediaType prefers `filename*` when both are present and hands back
// the decoded raw name, which is not the value this test is about.
func asciiFilename(header string) string {
	const marker = `filename="`
	start := strings.Index(header, marker)
	if start < 0 {
		return ""
	}
	rest := header[start+len(marker):]
	end := strings.Index(rest, `"`)
	if end < 0 {
		return ""
	}
	return rest[:end]
}
