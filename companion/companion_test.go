package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func f(x float64) *float64 { return &x }

func TestFramingRoundTrip(t *testing.T) {
	var buf bytes.Buffer
	w := &writer{w: &buf}
	if err := w.send(map[string]any{"type": "hello", "n": 1}); err != nil {
		t.Fatal(err)
	}
	if n := binary.LittleEndian.Uint32(buf.Bytes()[:4]); int(n) != buf.Len()-4 {
		t.Fatalf("length prefix %d, body %d", n, buf.Len()-4)
	}
	var got map[string]any
	if err := readMessage(&buf, &got); err != nil || got["type"] != "hello" {
		t.Fatalf("got %v, %v", got, err)
	}
	var huge bytes.Buffer
	binary.Write(&huge, binary.LittleEndian, uint32(maxIncoming+1))
	if err := readMessage(&huge, &got); err == nil {
		t.Fatal("oversized message accepted")
	}
}

func TestValidateRejectsUnsafeInput(t *testing.T) {
	bad := []download{
		{URL: "file:///etc/passwd", Kind: "video"},
		{URL: "--exec=calc", Kind: "video"},
		{URL: "javascript:alert(1)", Kind: "video"},
		{URL: "https://", Kind: "video"},
		{URL: "https://youtu.be/x", Kind: "exe"},
		{URL: "https://youtu.be/x", Kind: "video", Start: f(10)},
		{URL: "https://youtu.be/x", Kind: "video", Start: f(10), End: f(5)},
		{URL: "https://youtu.be/" + strings.Repeat("a", 3000), Kind: "video"},
	}
	for _, d := range bad {
		if d.validate() == nil {
			t.Errorf("accepted %+v", d)
		}
	}
	ok := download{URL: "https://x.com/user/status/1", Kind: "audio"}
	if err := ok.validate(); err != nil {
		t.Fatal(err)
	}
}

func TestArgsAreFixedAndEndWithTheLink(t *testing.T) {
	d := download{URL: "https://www.youtube.com/watch?v=abc", Kind: "video", Start: f(12.5), End: f(40)}
	a := d.args("/dl", "/usr/bin/ffmpeg")
	if a[len(a)-2] != "--" || a[len(a)-1] != d.URL {
		t.Fatalf("link must come last, after --: %v", a[len(a)-2:])
	}
	for _, want := range []string{"--ignore-config", "--no-playlist", "--restrict-filenames", "*12.50-40.00"} {
		if !slices.Contains(a, want) {
			t.Errorf("missing %s", want)
		}
	}
	for _, banned := range []string{"--exec", "--cookies", "--netrc", "--netrc-cmd", "--external-downloader", "--downloader"} {
		for _, x := range a {
			if strings.HasPrefix(x, banned) {
				t.Errorf("must never pass %s", banned)
			}
		}
	}
	if !slices.Contains(a, "%(title).80B [%(id)s] 12s-40s.%(ext)s") {
		t.Errorf("a clip needs its own file name: %v", a)
	}
	if got := (download{Kind: "video", Start: f(75), End: f(130)}).outputName(); got != "%(title).80B [%(id)s] 1m15s-2m10s.%(ext)s" {
		t.Errorf("clip name %s", got)
	}
	noFF := download{URL: "https://youtu.be/x", Kind: "video"}.args("/dl", "")
	if !slices.Contains(noFF, "b[ext=mp4]/b") {
		t.Error("without ffmpeg, pick a single-file format")
	}
}

func TestParseProgress(t *testing.T) {
	p, ok := parseProgress("YTKP  45.3%| 2.10MiB/s|00:12")
	if !ok || p.Percent != 45.3 || p.Speed != "2.10MiB/s" || p.ETA != "00:12" {
		t.Fatalf("%+v %v", p, ok)
	}
	if _, ok := parseProgress("[download] Destination: x.mp4"); ok {
		t.Fatal("not a progress line")
	}
}

func TestSumFor(t *testing.T) {
	sums := "aa11  yt-dlp\nBB22  yt-dlp.exe\ncc33 *yt-dlp_linux\n"
	if sumFor(sums, "yt-dlp.exe") != "bb22" || sumFor(sums, "yt-dlp_linux") != "cc33" || sumFor(sums, "nope") != "" {
		t.Fatal("wrong checksum lookup")
	}
}

func TestWithin(t *testing.T) {
	if !within("/dl", "/dl/a/b.mp4") || within("/dl", "/dl/../etc/passwd") || within("/dl", "/other") {
		t.Fatal("reveal must stay inside the downloads folder")
	}
}

func TestInstallWritesHostManifest(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("YTK_COMPANION_DIR", filepath.Join(tmp, "app"))
	t.Setenv("YTK_NM_DIRS", filepath.Join(tmp, "nm"))
	if err := install([]string{"not-an-id"}, ""); err == nil {
		t.Fatal("accepted a bad extension ID")
	}
	exe, _ := copySelf(filepath.Join(tmp, "app"))
	id := strings.Repeat("a", 32)
	if err := register(filepath.Join(tmp, "app"), exe, []string{id}); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(filepath.Join(tmp, "nm", HostName+".json"))
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	json.Unmarshal(b, &m)
	if m["path"] != exe || m["type"] != "stdio" || m["allowed_origins"].([]any)[0] != "chrome-extension://"+id+"/" {
		t.Fatalf("bad manifest: %s", b)
	}
}
