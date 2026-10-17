//go:build !windows

package main

import (
	"os"
	"path/filepath"
)

func register(dir, exe string, ids []string) error {
	manifest := hostManifest(exe, ids)
	for _, d := range manifestDirs() {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(d, HostName+".json"), manifest, 0o644); err != nil {
			return err
		}
	}
	return nil
}

func unregister(dir string) error {
	for _, d := range manifestDirs() {
		os.Remove(filepath.Join(d, HostName+".json"))
	}
	return nil
}
