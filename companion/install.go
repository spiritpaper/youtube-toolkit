package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
)

// HostName is how the extension finds the companion (chrome.runtime.connectNative).
const HostName = "com.spiritpaper.yt_toolkit"

var extensionID = regexp.MustCompile(`^[a-p]{32}$`)

type config struct {
	ExtensionIDs []string `json:"extensionIds"`
	Downloads    string   `json:"downloads"`
}

// installDir is where the companion keeps itself, the downloader and its settings.
func installDir() string {
	if d := os.Getenv("YTK_COMPANION_DIR"); d != "" {
		return d
	}
	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "windows":
		base := os.Getenv("LOCALAPPDATA")
		if base == "" {
			base = filepath.Join(home, "AppData", "Local")
		}
		return filepath.Join(base, "YT Toolkit Companion")
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "YT Toolkit Companion")
	default:
		base := os.Getenv("XDG_DATA_HOME")
		if base == "" {
			base = filepath.Join(home, ".local", "share")
		}
		return filepath.Join(base, "yt-toolkit-companion")
	}
}

func defaultDownloads() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Downloads", "YT Toolkit")
}

func loadConfig() config {
	cfg := config{Downloads: defaultDownloads()}
	if b, err := os.ReadFile(filepath.Join(installDir(), "config.json")); err == nil {
		json.Unmarshal(b, &cfg)
	}
	if cfg.Downloads == "" {
		cfg.Downloads = defaultDownloads()
	}
	return cfg
}

// hostManifest is the file Chrome reads to find and trust the companion.
func hostManifest(exe string, ids []string) []byte {
	origins := make([]string, len(ids))
	for i, id := range ids {
		origins[i] = "chrome-extension://" + id + "/"
	}
	b, _ := json.MarshalIndent(map[string]any{
		"name":            HostName,
		"description":     "YT Toolkit companion (video downloads)",
		"path":            exe,
		"type":            "stdio",
		"allowed_origins": origins,
	}, "", "  ")
	return b
}

// manifestDirs lists where Chromium-based browsers look for host manifests
// (macOS and Linux; Windows uses the registry, see register_windows.go).
func manifestDirs() []string {
	if v := os.Getenv("YTK_NM_DIRS"); v != "" {
		return filepath.SplitList(v)
	}
	home, _ := os.UserHomeDir()
	var browsers []string
	switch runtime.GOOS {
	case "darwin":
		base := filepath.Join(home, "Library", "Application Support")
		browsers = []string{filepath.Join(base, "Google", "Chrome"), filepath.Join(base, "Chromium"), filepath.Join(base, "Microsoft Edge"), filepath.Join(base, "BraveSoftware", "Brave-Browser")}
	default:
		base := filepath.Join(home, ".config")
		browsers = []string{filepath.Join(base, "google-chrome"), filepath.Join(base, "chromium"), filepath.Join(base, "microsoft-edge"), filepath.Join(base, "BraveSoftware", "Brave-Browser")}
	}
	var dirs []string
	for i, b := range browsers {
		// Always register with Chrome; with the others only if they're installed.
		if i == 0 || fileExists(b) {
			dirs = append(dirs, filepath.Join(b, "NativeMessagingHosts"))
		}
	}
	return dirs
}

func install(ids []string, downloads string) error {
	var clean []string
	for _, id := range ids {
		id = strings.ToLower(strings.TrimSpace(id))
		if id == "" {
			continue
		}
		if !extensionID.MatchString(id) {
			return fmt.Errorf("%q isn't an extension ID (32 letters a–p, shown in YT Toolkit → Settings → Video downloads)", id)
		}
		clean = append(clean, id)
	}
	if len(clean) == 0 {
		return errors.New("no extension ID given")
	}
	dir := installDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	// Keep previously allowed IDs (e.g. a second copy of the extension).
	cfg := loadConfig()
	for _, id := range cfg.ExtensionIDs {
		if !contains(clean, id) {
			clean = append(clean, id)
		}
	}
	cfg.ExtensionIDs = clean
	if downloads != "" {
		abs, err := filepath.Abs(downloads)
		if err != nil {
			return err
		}
		cfg.Downloads = abs
	}
	b, _ := json.MarshalIndent(cfg, "", "  ")
	if err := os.WriteFile(filepath.Join(dir, "config.json"), b, 0o644); err != nil {
		return err
	}

	exe, err := copySelf(dir)
	if err != nil {
		return err
	}
	if err := register(dir, exe, clean); err != nil {
		return err
	}
	fmt.Println("Registered with your browser.")

	fmt.Println("Getting the downloader (yt-dlp), checking its checksum…")
	v, err := updateDownloader(dir)
	if err != nil {
		return fmt.Errorf("couldn't get the downloader: %w", err)
	}
	fmt.Println("Downloader ready:", v)
	if ffmpegPath(dir) == "" {
		fmt.Println("\nOptional: install ffmpeg for 1080p video and clips (without it, downloads use the best single-file quality).")
		switch runtime.GOOS {
		case "windows":
			fmt.Println("  winget install Gyan.FFmpeg")
		case "darwin":
			fmt.Println("  brew install ffmpeg")
		default:
			fmt.Println("  sudo apt install ffmpeg   (or your distribution's package manager)")
		}
	}
	fmt.Println("\nDone. Downloads go to", cfg.Downloads)
	fmt.Println("Back in YT Toolkit, click \"Check again\" in Settings → Video downloads.")
	return nil
}

// copySelf puts this program in the install folder so the browser can find it
// even if the downloaded copy is deleted. Returns its path there.
func copySelf(dir string) (string, error) {
	self, err := os.Executable()
	if err != nil {
		return "", err
	}
	name := "yt-toolkit-companion"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	dst := filepath.Join(dir, name)
	if same, _ := sameFile(self, dst); same {
		return dst, nil
	}
	in, err := os.Open(self)
	if err != nil {
		return "", err
	}
	defer in.Close()
	tmp := dst + ".new"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		return "", err
	}
	out.Close()
	if err := os.Rename(tmp, dst); err != nil {
		// Windows can't replace a running .exe: the old copy stays until it exits.
		os.Remove(tmp)
		if fileExists(dst) {
			return dst, nil
		}
		return "", err
	}
	return dst, nil
}

func sameFile(a, b string) (bool, error) {
	ia, err := os.Stat(a)
	if err != nil {
		return false, err
	}
	ib, err := os.Stat(b)
	if err != nil {
		return false, err
	}
	return os.SameFile(ia, ib), nil
}

func uninstall() error {
	if err := unregister(installDir()); err != nil {
		return err
	}
	cfg := loadConfig()
	dir := installDir()
	if runtime.GOOS == "windows" {
		// The running .exe can't delete itself; remove everything else.
		entries, _ := os.ReadDir(dir)
		for _, e := range entries {
			if !strings.HasSuffix(e.Name(), "companion.exe") {
				os.RemoveAll(filepath.Join(dir, e.Name()))
			}
		}
		fmt.Println("You can delete the folder", dir, "now.")
	} else if err := os.RemoveAll(dir); err != nil {
		return err
	}
	fmt.Println("Removed. Your downloads in", cfg.Downloads, "were kept.")
	return nil
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}
