//go:build windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
)

// Chromium-based browsers on Windows find hosts through HKCU registry keys
// whose default value is the path to the host manifest.
var registryKeys = []string{
	`HKCU\Software\Google\Chrome\NativeMessagingHosts\` + HostName,
	`HKCU\Software\Chromium\NativeMessagingHosts\` + HostName,
	`HKCU\Software\Microsoft\Edge\NativeMessagingHosts\` + HostName,
	`HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\` + HostName,
}

func register(dir, exe string, ids []string) error {
	path := filepath.Join(dir, HostName+".json")
	if err := os.WriteFile(path, hostManifest(exe, ids), 0o644); err != nil {
		return err
	}
	for _, k := range registryKeys {
		cmd := exec.Command("reg", "add", k, "/ve", "/t", "REG_SZ", "/d", path, "/f")
		hideWindow(cmd)
		if err := cmd.Run(); err != nil {
			return err
		}
	}
	return nil
}

func unregister(dir string) error {
	for _, k := range registryKeys {
		cmd := exec.Command("reg", "delete", k, "/f")
		hideWindow(cmd)
		cmd.Run()
	}
	os.Remove(filepath.Join(dir, HostName+".json"))
	return nil
}
