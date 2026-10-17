package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// The downloader is yt-dlp's official standalone build, fetched from its
// GitHub releases and checked against the published SHA-256 sums.
const ytdlpReleases = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/"

func ytdlpAsset() (string, error) {
	switch runtime.GOOS + "/" + runtime.GOARCH {
	case "windows/amd64":
		return "yt-dlp.exe", nil
	case "windows/arm64":
		return "yt-dlp_arm64.exe", nil
	case "windows/386":
		return "yt-dlp_x86.exe", nil
	case "darwin/amd64", "darwin/arm64":
		return "yt-dlp_macos", nil
	case "linux/amd64":
		return "yt-dlp_linux", nil
	case "linux/arm64":
		return "yt-dlp_linux_aarch64", nil
	}
	return "", fmt.Errorf("no downloader build for %s/%s", runtime.GOOS, runtime.GOARCH)
}

func downloaderPath(dir string) string {
	name := "yt-dlp"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	return filepath.Join(dir, name)
}

// updateDownloader downloads the latest downloader into dir after checking
// its checksum. Returns its version.
func updateDownloader(dir string) (string, error) {
	asset, err := ytdlpAsset()
	if err != nil {
		return "", err
	}
	client := &http.Client{Timeout: 5 * time.Minute}
	sums, err := fetch(client, ytdlpReleases+"SHA2-256SUMS", 1<<20)
	if err != nil {
		return "", err
	}
	want := sumFor(string(sums), asset)
	if want == "" {
		return "", fmt.Errorf("no checksum for %s", asset)
	}
	bin, err := fetch(client, ytdlpReleases+asset, 200<<20)
	if err != nil {
		return "", err
	}
	got := sha256.Sum256(bin)
	if hex.EncodeToString(got[:]) != want {
		return "", errors.New("checksum mismatch: the download was not the official build, nothing was installed")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	dst := downloaderPath(dir)
	tmp := dst + ".new"
	if err := os.WriteFile(tmp, bin, 0o755); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, dst); err != nil {
		os.Remove(tmp)
		return "", err
	}
	return downloaderVersion(dir), nil
}

func fetch(client *http.Client, u string, limit int64) ([]byte, error) {
	resp, err := client.Get(u)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s: %s", u, resp.Status)
	}
	return io.ReadAll(io.LimitReader(resp.Body, limit))
}

// sumFor finds the hash for name in a "hash  name" checksum list.
func sumFor(sums, name string) string {
	for _, line := range strings.Split(sums, "\n") {
		f := strings.Fields(line)
		if len(f) == 2 && strings.TrimPrefix(f[1], "*") == name {
			return strings.ToLower(f[0])
		}
	}
	return ""
}

func downloaderVersion(dir string) string {
	p := downloaderPath(dir)
	if _, err := os.Stat(p); err != nil {
		return ""
	}
	cmd := exec.Command(p, "--version")
	hideWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func ffmpegPath(dir string) string {
	name := "ffmpeg"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	if p := filepath.Join(dir, name); fileExists(p) {
		return p
	}
	if p, err := exec.LookPath(name); err == nil {
		return p
	}
	return ""
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }

// ---------- one download ----------

type download struct {
	URL   string
	Kind  string // video | audio
	Start *float64
	End   *float64
}

func (d download) validate() error {
	if len(d.URL) > 2048 {
		return errors.New("that link is too long")
	}
	u, err := url.Parse(d.URL)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
		return errors.New("only http(s) links can be downloaded")
	}
	if d.Kind != "video" && d.Kind != "audio" {
		return errors.New("choose video or audio")
	}
	if (d.Start == nil) != (d.End == nil) {
		return errors.New("a clip needs a start and an end")
	}
	if d.Start != nil && (*d.Start < 0 || *d.End <= *d.Start || *d.End > 24*3600) {
		return errors.New("the clip's end must come after its start")
	}
	return nil
}

// args builds the downloader's command line. Everything is fixed except the
// validated link and clip times: no config files are read (--ignore-config),
// no commands run afterwards, no cookies, no external downloaders, file
// names restricted to safe characters inside the downloads folder.
func (d download) args(folder, ffmpeg string) []string {
	a := []string{
		"--ignore-config", "--no-playlist", "--no-mtime",
		"--restrict-filenames", "--windows-filenames", "--trim-filenames", "120",
		"-P", folder, "-o", d.outputName(),
		"--quiet", "--no-warnings", "--progress", "--newline",
		"--progress-template", "download:YTKP %(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s",
		"--print", "after_move:YTKF %(filepath)s",
	}
	if ffmpeg != "" {
		a = append(a, "--ffmpeg-location", ffmpeg)
	}
	switch {
	case d.Kind == "audio":
		a = append(a, "-f", "ba[ext=m4a]/ba")
	case ffmpeg != "":
		a = append(a, "-f", "bv*[height<=1080]+ba/b[height<=1080]/b", "--merge-output-format", "mp4")
	default:
		// Without ffmpeg, only formats that already contain sound and picture.
		a = append(a, "-f", "b[ext=mp4]/b")
	}
	if d.Start != nil {
		a = append(a, "--download-sections", fmt.Sprintf("*%s-%s", secs(*d.Start), secs(*d.End)))
	}
	return append(a, "--", d.URL)
}

// outputName keeps clips from overwriting (or being mistaken for) the full video.
func (d download) outputName() string {
	if d.Start != nil {
		return fmt.Sprintf("%%(title).80B [%%(id)s] %s-%s.%%(ext)s", clock(*d.Start), clock(*d.End))
	}
	if d.Kind == "audio" {
		return "%(title).80B [%(id)s] audio.%(ext)s"
	}
	return "%(title).80B [%(id)s].%(ext)s"
}

// clock turns 75.5 into "1m15s" for file names.
func clock(f float64) string {
	s := int(f)
	if s >= 60 {
		return fmt.Sprintf("%dm%02ds", s/60, s%60)
	}
	return fmt.Sprintf("%ds", s)
}

func secs(f float64) string { return strconv.FormatFloat(f, 'f', 2, 64) }

type progress struct {
	Percent float64 `json:"percent"`
	Speed   string  `json:"speed"`
	ETA     string  `json:"eta"`
}

// parseProgress reads a "YTKP  45.3%| 2.10MiB/s|00:12" line.
func parseProgress(line string) (progress, bool) {
	rest, ok := strings.CutPrefix(strings.TrimSpace(line), "YTKP")
	if !ok {
		return progress{}, false
	}
	parts := strings.Split(rest, "|")
	if len(parts) != 3 {
		return progress{}, false
	}
	pct, err := strconv.ParseFloat(strings.TrimSuffix(strings.TrimSpace(parts[0]), "%"), 64)
	if err != nil {
		return progress{}, false
	}
	return progress{Percent: pct, Speed: strings.TrimSpace(parts[1]), ETA: strings.TrimSpace(parts[2])}, true
}

func (d download) run(ctx context.Context, cfg config, onProgress func(progress)) (string, error) {
	dir := installDir()
	bin := downloaderPath(dir)
	if !fileExists(bin) {
		return "", errors.New("the downloader isn't installed: run the companion again to set it up")
	}
	ff := ffmpegPath(dir)
	if d.Start != nil && ff == "" {
		return "", errors.New("downloading a clip needs ffmpeg; install it, or download the whole video")
	}
	if err := os.MkdirAll(cfg.Downloads, 0o755); err != nil {
		return "", err
	}
	cmd := exec.CommandContext(ctx, bin, d.args(cfg.Downloads, ff)...)
	hideWindow(cmd)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return "", err
	}
	var stderr strings.Builder
	cmd.Stderr = &limitedWriter{w: &stderr, n: 64 << 10}
	if err := cmd.Start(); err != nil {
		return "", err
	}
	var file string
	sc := bufio.NewScanner(stdout)
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	var last time.Time
	for sc.Scan() {
		line := sc.Text()
		if p, ok := parseProgress(line); ok {
			if time.Since(last) > 400*time.Millisecond || p.Percent >= 100 {
				onProgress(p)
				last = time.Now()
			}
		} else if f, ok := strings.CutPrefix(line, "YTKF "); ok {
			file = strings.TrimSpace(f)
		}
	}
	if err := cmd.Wait(); err != nil {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		return "", errors.New(errorLine(stderr.String(), err))
	}
	return file, nil
}

// errorLine picks the downloader's own explanation, if it gave one.
func errorLine(stderr string, err error) string {
	lines := strings.Split(strings.TrimSpace(stderr), "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if msg, ok := strings.CutPrefix(strings.TrimSpace(lines[i]), "ERROR: "); ok {
			return msg
		}
	}
	return "the download failed (" + err.Error() + ")"
}

type limitedWriter struct {
	w io.Writer
	n int
}

func (l *limitedWriter) Write(p []byte) (int, error) {
	if l.n > 0 {
		k := min(len(p), l.n)
		l.w.Write(p[:k])
		l.n -= k
	}
	return len(p), nil
}
