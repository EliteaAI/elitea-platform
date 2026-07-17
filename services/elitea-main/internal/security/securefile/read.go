// Package securefile reads bounded deployment files without following path
// aliases. It is intended for startup-time key, password and trust material.
package securefile

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const maxPathBytes = 4096

type Permissions uint8

const (
	PublicMaterial Permissions = iota + 1
	PrivateMaterial
)

// Read requires an absolute, already canonical path whose final component is
// not a symlink. The Lstat/open/fstat identity check detects replacement
// between path validation and use. Private material must be owner-readable and
// may only carry owner read/write bits; public certificate material may be
// world-readable but never writable by group/other or executable.
func Read(path string, maxBytes int64, permissions Permissions) ([]byte, error) {
	if path == "" || len(path) > maxPathBytes || strings.ContainsAny(path, "\r\n\x00") || !filepath.IsAbs(path) || filepath.Clean(path) != path || maxBytes <= 0 {
		return nil, errors.New("secure file path or size is invalid")
	}
	canonical, err := filepath.EvalSymlinks(path)
	if err != nil {
		return nil, err
	}
	if canonical != path {
		return nil, errors.New("secure file path must be canonical and contain no symlink")
	}
	pathInfo, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !pathInfo.Mode().IsRegular() || pathInfo.Mode()&os.ModeSymlink != 0 || pathInfo.Size() <= 0 || pathInfo.Size() > maxBytes {
		return nil, errors.New("secure file is not a bounded regular file")
	}
	if err := validatePermissions(pathInfo.Mode().Perm(), permissions); err != nil {
		return nil, err
	}

	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	openedInfo, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !os.SameFile(pathInfo, openedInfo) || !openedInfo.Mode().IsRegular() || openedInfo.Size() <= 0 || openedInfo.Size() > maxBytes {
		return nil, errors.New("secure file changed during open")
	}
	contents, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if len(contents) == 0 || int64(len(contents)) > maxBytes {
		return nil, errors.New("secure file exceeds the approved bound")
	}
	return contents, nil
}

func validatePermissions(mode os.FileMode, permissions Permissions) error {
	if mode&0o400 == 0 {
		return errors.New("secure file must be readable by its owner")
	}
	switch permissions {
	case PrivateMaterial:
		if mode & ^os.FileMode(0o600) != 0 {
			return errors.New("private file permissions must be owner-only")
		}
	case PublicMaterial:
		if mode&0o111 != 0 || mode&0o022 != 0 {
			return errors.New("public trust file cannot be executable or writable by group/other")
		}
	default:
		return fmt.Errorf("unsupported secure file permission profile %d", permissions)
	}
	return nil
}
