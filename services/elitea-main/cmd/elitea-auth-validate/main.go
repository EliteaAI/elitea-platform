package main

import (
	"flag"
	"io"
	"os"
	"strings"

	browserapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/browserauth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/security/securefile"
)

const (
	exitValid         = 0
	exitInvalid       = 1
	exitInvalidUsage  = 2
	formUsersFlag     = "form-users-file"
	invalidUsageText  = "invalid arguments\n"
	invalidConfigText = "Form configuration validation failed\n"
)

func main() {
	os.Exit(run(os.Args[1:], os.Stderr))
}

// run intentionally has no stdout writer. A valid secret-bearing snapshot is
// reported only through exit status; failures never include a path, parser
// detail, login, password, or provider attribute.
func run(arguments []string, stderr io.Writer) int {
	if countFlag(arguments, formUsersFlag) != 1 {
		_, _ = io.WriteString(stderr, invalidUsageText)
		return exitInvalidUsage
	}

	flags := flag.NewFlagSet("elitea-auth-validate", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	input := flags.String(formUsersFlag, "", "absolute path to the resolved Form users snapshot")
	if err := flags.Parse(arguments); err != nil || *input == "" || flags.NArg() != 0 {
		_, _ = io.WriteString(stderr, invalidUsageText)
		return exitInvalidUsage
	}

	if !validResolvedFormFile(*input) {
		_, _ = io.WriteString(stderr, invalidConfigText)
		return exitInvalid
	}
	return exitValid
}

func countFlag(arguments []string, name string) int {
	count := 0
	short := "-" + name
	long := "--" + name
	for _, argument := range arguments {
		if argument == short || argument == long || strings.HasPrefix(argument, short+"=") ||
			strings.HasPrefix(argument, long+"=") {
			count++
		}
	}
	return count
}

func validResolvedFormFile(path string) bool {
	raw, err := securefile.Read(
		path,
		browserapp.MaxFormConfigurationBytes,
		securefile.PrivateMaterial,
	)
	if err != nil {
		return false
	}
	defer clear(raw)

	_, err = browserapp.NewFormProvider(raw)
	return err == nil
}
