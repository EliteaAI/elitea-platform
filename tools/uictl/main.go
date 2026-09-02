// Command uictl is the UI-reimplementation parity gate tool
// (spec-ui-reimplementation §8.3, unit P1).
//
// Implemented subcommands:
//
//	parity-manifest --validate      schema + evidence validation of manifest.json
//	parity-manifest --require-must  fails unless every `must` item is `verified`
//	parity-routes                   extracts the baseline route patterns and
//	                                diffs them against the manifest ROUTE items;
//	                                optionally diffs a new-app route export too
//
// Documented not-yet-implemented subcommands (owned by later units; they exit
// non-zero by design so they can never green a pipeline silently):
//
//	verify-routes                   unit R1 (needs the new TanStack router)
//	diff-config                     unit F3 (needs the new runtime config)
package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/EliteaAI/elitea-platform/tools/uictl/internal/manifest"
	"github.com/EliteaAI/elitea-platform/tools/uictl/internal/routes"
)

const defaultBaseline = "apps/elitea-ui"
const defaultManifest = "apps/elitea-web/parity/manifest.json"

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	switch os.Args[1] {
	case "parity-manifest":
		os.Exit(cmdParityManifest(os.Args[2:]))
	case "parity-routes":
		os.Exit(cmdParityRoutes(os.Args[2:]))
	case "verify-routes":
		fmt.Fprintln(os.Stderr, "uictl verify-routes: NOT IMPLEMENTED in unit P1.")
		fmt.Fprintln(os.Stderr, "This subcommand belongs to unit R1 (spec §9.3): it verifies the NEW app's")
		fmt.Fprintln(os.Stderr, "mounted TanStack router against the manifest, which requires the new router")
		fmt.Fprintln(os.Stderr, "to exist. Until R1 lands, this command always exits 3 so no pipeline can")
		fmt.Fprintln(os.Stderr, "treat it as a passing gate.")
		os.Exit(3)
	case "diff-config":
		fmt.Fprintln(os.Stderr, "uictl diff-config: NOT IMPLEMENTED in unit P1.")
		fmt.Fprintln(os.Stderr, "This subcommand belongs to unit F3 (spec §9.3): it diffs the runtime config")
		fmt.Fprintln(os.Stderr, "contract (§7.1) between the old entrypoint-generated config.js and the new")
		fmt.Fprintln(os.Stderr, "app's config surface. Until F3 lands, this command always exits 3 so no")
		fmt.Fprintln(os.Stderr, "pipeline can treat it as a passing gate.")
		os.Exit(3)
	default:
		fmt.Fprintf(os.Stderr, "uictl: unknown subcommand %q\n\n", os.Args[1])
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `usage:
  uictl parity-manifest --validate [--manifest <path>] [--baseline <path>]
  uictl parity-manifest --require-must [--manifest <path>]
  uictl parity-routes [--baseline <path>] [--manifest <path>] [--new-routes <path>]
  uictl verify-routes   (not implemented: unit R1)
  uictl diff-config     (not implemented: unit F3)
`)
}

func cmdParityManifest(args []string) int {
	fs := flag.NewFlagSet("parity-manifest", flag.ExitOnError)
	validate := fs.Bool("validate", false, "run schema + evidence validation")
	requireMust := fs.Bool("require-must", false, "fail unless every priority:must item is status:verified")
	domain := fs.String("domain", "", "with --require-must: audit only this domain (a cutover/<domain> branch)")
	manifestPath := fs.String("manifest", defaultManifest, "path to manifest.json")
	baseline := fs.String("baseline", defaultBaseline, "path to the pinned apps/elitea-ui checkout")
	_ = fs.Parse(args)

	if !*validate && !*requireMust {
		fmt.Fprintln(os.Stderr, "uictl parity-manifest: pass --validate and/or --require-must")
		return 2
	}
	m, err := manifest.Load(*manifestPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "uictl: %v\n", err)
		return 1
	}
	rc := 0
	if *validate {
		problems := manifest.Validate(m, *baseline)
		problems = append(problems, manifest.CheckImmutability(m, *manifestPath)...)
		if len(problems) > 0 {
			for _, p := range problems {
				fmt.Fprintf(os.Stderr, "INVALID: %s\n", p)
			}
			fmt.Fprintf(os.Stderr, "uictl parity-manifest --validate: %d problem(s) in %d items\n", len(problems), len(m.Items))
			rc = 1
		} else {
			fmt.Printf("uictl parity-manifest --validate: OK (%d items, evidence resolved against %s)\n", len(m.Items), *baseline)
		}
	}
	if *requireMust {
		if *domain != "" && !manifest.HasDomain(m, *domain) {
			// A typo here would audit nothing and pass. Refuse instead.
			fmt.Fprintf(os.Stderr, "uictl parity-manifest --require-must: no item carries domain %q\n", *domain)
			return 2
		}
		unverified := manifest.UnverifiedMust(m, *domain)
		if len(unverified) > 0 {
			for _, id := range unverified {
				fmt.Fprintf(os.Stderr, "NOT VERIFIED: %s\n", id)
			}
			fmt.Fprintf(os.Stderr, "uictl parity-manifest --require-must: %d priority:must item(s) not verified\n", len(unverified))
			rc = 1
		} else {
			scope := "every must item"
			if *domain != "" {
				scope = "every must item in domain " + *domain
			}
			fmt.Printf("uictl parity-manifest --require-must: OK (%s verified)\n", scope)
		}
	}
	return rc
}

func cmdParityRoutes(args []string) int {
	fs := flag.NewFlagSet("parity-routes", flag.ExitOnError)
	baseline := fs.String("baseline", defaultBaseline, "path to the pinned apps/elitea-ui checkout")
	manifestPath := fs.String("manifest", defaultManifest, "path to manifest.json")
	newRoutes := fs.String("new-routes", "", "optional: JSON file exporting the NEW app's mounted route patterns ([]string); when the new router exists this becomes the second side of the diff")
	_ = fs.Parse(args)

	ext, err := routes.ExtractBaseline(*baseline)
	if err != nil {
		fmt.Fprintf(os.Stderr, "uictl parity-routes: %v\n", err)
		return 1
	}
	m, err := manifest.Load(*manifestPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "uictl parity-routes: %v\n", err)
		return 1
	}
	problems := routes.DiffManifest(ext, m)
	if *newRoutes != "" {
		np, err := routes.LoadNewRoutes(*newRoutes)
		if err != nil {
			fmt.Fprintf(os.Stderr, "uictl parity-routes: %v\n", err)
			return 1
		}
		problems = append(problems, routes.DiffNewApp(ext, np)...)
	}
	if len(problems) > 0 {
		for _, p := range problems {
			fmt.Fprintf(os.Stderr, "ROUTE DIFF: %s\n", p)
		}
		fmt.Fprintf(os.Stderr, "uictl parity-routes: %d problem(s)\n", len(problems))
		return 1
	}
	fmt.Printf("uictl parity-routes: OK (%d mounted patterns + %d declared-only anomalies match the manifest)\n",
		len(ext.Mounted), len(ext.DeclaredOnly))
	return 0
}
