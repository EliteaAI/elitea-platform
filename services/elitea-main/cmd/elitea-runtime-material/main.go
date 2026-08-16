// Command elitea-runtime-material installs the runtime plane's private
// material where internal/security/securefile can read it.
//
// # Why the command exists
//
// The runtime plane reads its keys, passwords and certificates through
// securefile. That reader refuses a path that resolves through a symlink, and
// it requires owner-only bits on private material.
//
// A Kubernetes Secret volume satisfies neither condition:
//
//   - Mounted whole, it is a symlink farm. The kubelet writes the data into a
//     timestamped directory and projects each key as a symlink through
//     "..data". securefile refuses every one of those paths.
//   - Mounted one file at a time with subPath, the files are real, but the
//     kubelet owns them as root. The pod runs as a nonroot user, and no file
//     mode makes a root-owned file readable by that user without also setting
//     a group or other bit that securefile refuses on private material.
//
// So the material must be copied. This command runs as an init container, with
// the same user as the service, before the service starts. It reads the Secret
// volume, writes one real file for each key into a volume that the service
// also mounts, and gives each written file owner-only bits. The service then
// meets the layout that securefile accepts, and no securefile rule changes.
//
// The compose stack solves the same problem in the same way. Read
// deploy/runtime/install-material.sh: it copies the generated material into a
// per-consumer volume and sets the owner and the mode that each reader needs.
//
// # What it copies, and what it proves
//
// The command copies every key of the Secret volume. It then reads back every
// file that the runtime configuration names, with the same permission profile
// that the service applies, and fails if any read fails. A missing key, a
// truncated file or a wrong mode therefore stops the pod in this container,
// with a message, instead of in a restart loop of the service container.
//
// Usage:
//
//	elitea-runtime-material -source /run/elitea-runtime-source
//
// The destination is not an argument. The command reads the runtime
// environment block, which already names every file that the service opens,
// and it writes into the one directory that holds them. A second knob could
// disagree with that block; a derived destination cannot.
package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/runtimecomposition"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/security/securefile"
)

const (
	exitInstalled = 0
	exitFailed    = 1
	exitUsage     = 2

	// One material file is a certificate bundle at most. The largest bound that
	// any runtime reader applies is one mebibyte, so a larger source file could
	// never be read even after a good copy.
	maxMaterialFileBytes = 1 << 20
	// A Secret that holds more entries than this is not the runtime material.
	maxMaterialEntries = 64
	// The mode that securefile accepts for private material, and that the
	// public-material profile also accepts.
	materialFileMode = 0o600
	// The kubelet writes its own projection bookkeeping under names that start
	// with two dots. A Secret key can never start with two dots, so this prefix
	// hides no operator data.
	projectionPrefix = ".."
)

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(arguments []string, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("elitea-runtime-material", flag.ContinueOnError)
	flags.SetOutput(stderr)
	source := flags.String("source", "", "absolute path of the directory that holds the runtime material keys")
	if err := flags.Parse(arguments); err != nil {
		return exitUsage
	}
	if *source == "" || flags.NArg() != 0 {
		_, _ = fmt.Fprintln(stderr, "usage: elitea-runtime-material -source <directory>")
		return exitUsage
	}

	written, err := install(*source, os.LookupEnv)
	if err != nil {
		_, _ = fmt.Fprintf(stderr, "elitea-runtime-material: %v\n", err)
		return exitFailed
	}
	for _, name := range written {
		_, _ = fmt.Fprintf(stdout, "installed %s\n", name)
	}
	_, _ = fmt.Fprintf(stdout, "elitea-runtime-material: %d files installed\n", len(written))
	return exitInstalled
}

// install copies the material and then proves that the service can read it.
// It returns the destination paths that it wrote, in a stable order.
func install(source string, lookup runtimecomposition.LookupEnv) ([]string, error) {
	config, err := runtimecomposition.ConfigFromEnv(lookup)
	if err != nil {
		return nil, fmt.Errorf("read the runtime environment block: %w", err)
	}
	if !config.Enabled {
		return nil, errors.New("ELITEA_RUNTIME_ENABLED is not true, so there is no material to install")
	}
	required, err := config.MaterialFiles()
	if err != nil {
		return nil, err
	}
	destination, err := config.MaterialDirectory()
	if err != nil {
		return nil, err
	}
	if err := requireDirectory(destination); err != nil {
		return nil, fmt.Errorf("the runtime material directory %s is not usable: %w", destination, err)
	}

	written, err := copyTree(source, destination)
	if err != nil {
		return nil, err
	}
	if err := verify(required); err != nil {
		return nil, err
	}
	return written, nil
}

// copyTree writes one real file for each key of the source directory.
//
// It resolves each entry and keeps only the ones that stay inside the source
// directory. A symlink that leaves the mount is refused, which is the property
// that securefile enforces for the service itself.
func copyTree(source, destination string) ([]string, error) {
	root, err := filepath.EvalSymlinks(source)
	if err != nil {
		return nil, fmt.Errorf("resolve the material source %s: %w", source, err)
	}
	if err := requireDirectory(root); err != nil {
		return nil, fmt.Errorf("the material source %s is not usable: %w", source, err)
	}
	if root == destination {
		return nil, fmt.Errorf("the material source and the material directory are both %s, and the copy needs two directories", destination)
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, fmt.Errorf("read the material source %s: %w", source, err)
	}
	if len(entries) > maxMaterialEntries {
		return nil, fmt.Errorf("the material source %s holds %d entries, and %d is the limit", source, len(entries), maxMaterialEntries)
	}

	written := make([]string, 0, len(entries))
	installed := make(map[string]struct{}, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if strings.HasPrefix(name, projectionPrefix) {
			continue
		}
		if name == "" || name != filepath.Base(name) || strings.ContainsRune(name, os.PathSeparator) {
			return nil, fmt.Errorf("the material source holds an unusable entry name %q", name)
		}
		resolved, err := resolveInside(root, name)
		if err != nil {
			return nil, err
		}
		if resolved == "" {
			continue
		}
		target := filepath.Join(destination, name)
		if err := copyFile(resolved, target); err != nil {
			return nil, fmt.Errorf("install %s: %w", name, err)
		}
		written = append(written, target)
		installed[name] = struct{}{}
	}
	if len(written) == 0 {
		return nil, fmt.Errorf("the material source %s holds no key", source)
	}
	if err := prune(destination, installed); err != nil {
		return nil, err
	}
	sort.Strings(written)
	return written, nil
}

// prune deletes anything in the destination that this run did not install.
//
// The destination must mirror the source, and nothing else. Without this, a
// file that an earlier run left behind would still satisfy the check below,
// so a key that the operator removed from the Secret, or replaced with a name
// that no longer matches, would keep serving its old contents.
func prune(destination string, installed map[string]struct{}) error {
	entries, err := os.ReadDir(destination)
	if err != nil {
		return fmt.Errorf("read the material directory %s: %w", destination, err)
	}
	for _, entry := range entries {
		name := entry.Name()
		if _, keep := installed[name]; keep {
			continue
		}
		if entry.IsDir() {
			return fmt.Errorf("the material directory %s holds a subdirectory %s, which this command did not create", destination, name)
		}
		if err := os.Remove(filepath.Join(destination, name)); err != nil {
			return fmt.Errorf("remove the stale material file %s: %w", name, err)
		}
	}
	return nil
}

// resolveInside resolves one source entry and keeps it only when it is a
// regular file that stays inside root. It returns an empty path for a
// directory, which the kubelet also projects, and an error for a symlink that
// escapes root.
func resolveInside(root, name string) (string, error) {
	resolved, err := filepath.EvalSymlinks(filepath.Join(root, name))
	if err != nil {
		return "", fmt.Errorf("resolve the material key %s: %w", name, err)
	}
	if resolved != filepath.Clean(resolved) || !strings.HasPrefix(resolved, root+string(os.PathSeparator)) {
		return "", fmt.Errorf("the material key %s resolves to %s, which is outside the source directory %s", name, resolved, root)
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", fmt.Errorf("read the material key %s: %w", name, err)
	}
	if info.IsDir() {
		return "", nil
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("the material key %s is not a regular file", name)
	}
	return resolved, nil
}

func copyFile(source, destination string) error {
	contents, err := readBounded(source)
	if err != nil {
		return err
	}
	defer clear(contents)

	// Remove first, so a rerun of this container replaces the file instead of
	// writing through a link that something else created in the shared volume.
	if err := os.Remove(destination); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	file, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, materialFileMode)
	if err != nil {
		return err
	}
	if _, err := file.Write(contents); err != nil {
		_ = file.Close()
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	// The process umask masks the mode that OpenFile requests, so set the mode
	// again. securefile compares the exact bits, and a masked 0600 would still
	// be 0600 only by luck of the environment.
	return os.Chmod(destination, materialFileMode)
}

func readBounded(path string) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = file.Close() }()
	contents, err := io.ReadAll(io.LimitReader(file, maxMaterialFileBytes+1))
	if err != nil {
		return nil, err
	}
	if len(contents) == 0 {
		return nil, errors.New("the source file is empty")
	}
	if len(contents) > maxMaterialFileBytes {
		return nil, fmt.Errorf("the source file is larger than %d bytes", maxMaterialFileBytes)
	}
	return contents, nil
}

// verify reads every file that the runtime configuration names, through the
// same reader and the same permission profile that the service applies. This
// is the gate: the pod stops here, with a message, rather than in a restart
// loop of the service container.
func verify(required []runtimecomposition.MaterialFile) error {
	for _, file := range required {
		contents, err := securefile.Read(file.Path, maxMaterialFileBytes, file.Permissions)
		if err != nil {
			return fmt.Errorf("the runtime cannot read %s after the copy: %w", file.Path, err)
		}
		clear(contents)
	}
	return nil
}

func requireDirectory(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return errors.New("the path is not a directory")
	}
	return nil
}
