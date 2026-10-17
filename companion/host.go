package main

import (
	"context"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
)

// Requests from the extension.
type request struct {
	Type  string   `json:"type"`  // hello | download | cancel | reveal | update
	Job   string   `json:"job"`   // id chosen by the extension
	URL   string   `json:"url"`   // download
	Kind  string   `json:"kind"`  // "video" or "audio"
	Start *float64 `json:"start"` // optional clip, in seconds
	End   *float64 `json:"end"`
	File  string   `json:"file"` // reveal
}

// serve runs the native messaging loop until Chrome closes the port.
func serve(in io.Reader, out io.Writer) error {
	w := &writer{w: out}
	cfg := loadConfig()
	var mu sync.Mutex
	jobs := map[string]context.CancelFunc{}
	var wg sync.WaitGroup
	defer wg.Wait()
	for {
		var req request
		if err := readMessage(in, &req); err != nil {
			if err == io.EOF {
				mu.Lock()
				for _, cancel := range jobs {
					cancel()
				}
				mu.Unlock()
				return nil
			}
			return err
		}
		switch req.Type {
		case "hello":
			w.send(hello(cfg))
		case "download":
			job := download{URL: req.URL, Kind: req.Kind, Start: req.Start, End: req.End}
			if err := job.validate(); err != nil {
				w.send(map[string]any{"type": "error", "job": req.Job, "message": err.Error()})
				continue
			}
			ctx, cancel := context.WithCancel(context.Background())
			mu.Lock()
			jobs[req.Job] = cancel
			mu.Unlock()
			wg.Add(1)
			go func(id string) {
				defer wg.Done()
				file, err := job.run(ctx, cfg, func(p progress) {
					w.send(map[string]any{"type": "progress", "job": id, "percent": p.Percent, "speed": p.Speed, "eta": p.ETA})
				})
				mu.Lock()
				delete(jobs, id)
				mu.Unlock()
				switch {
				case ctx.Err() != nil:
					w.send(map[string]any{"type": "cancelled", "job": id})
				case err != nil:
					w.send(map[string]any{"type": "error", "job": id, "message": err.Error()})
				default:
					w.send(map[string]any{"type": "done", "job": id, "file": file})
				}
			}(req.Job)
		case "cancel":
			mu.Lock()
			if cancel := jobs[req.Job]; cancel != nil {
				cancel()
			}
			mu.Unlock()
		case "reveal":
			w.send(map[string]any{"type": "revealed", "ok": reveal(cfg, req.File) == nil})
		case "update":
			v, err := updateDownloader(installDir())
			if err != nil {
				w.send(map[string]any{"type": "error", "message": "Couldn't update the downloader: " + err.Error()})
			} else {
				w.send(map[string]any{"type": "updated", "ytdlp": v})
			}
		default:
			w.send(map[string]any{"type": "error", "message": "unknown request"})
		}
	}
}

func hello(cfg config) map[string]any {
	return map[string]any{
		"type":    "hello",
		"version": Version,
		"ytdlp":   downloaderVersion(installDir()),
		"ffmpeg":  ffmpegPath(installDir()) != "",
		"folder":  cfg.Downloads,
	}
}

// reveal shows a downloaded file (or the downloads folder) in the file manager.
// Only paths inside the downloads folder are opened.
func reveal(cfg config, file string) error {
	target := cfg.Downloads
	if file != "" {
		abs, err := filepath.Abs(file)
		if err == nil && within(cfg.Downloads, abs) {
			target = abs
		}
	}
	os.MkdirAll(cfg.Downloads, 0o755)
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		if target == cfg.Downloads {
			cmd = exec.Command("explorer", target)
		} else {
			cmd = exec.Command("explorer", "/select,", target)
		}
	case "darwin":
		cmd = exec.Command("open", "-R", target)
	default:
		if target != cfg.Downloads {
			target = filepath.Dir(target)
		}
		cmd = exec.Command("xdg-open", target)
	}
	return cmd.Start()
}

func within(dir, path string) bool {
	rel, err := filepath.Rel(dir, path)
	return err == nil && rel != ".." && !filepath.IsAbs(rel) && !startsWithDotDot(rel)
}

func startsWithDotDot(rel string) bool {
	return len(rel) >= 3 && rel[:2] == ".." && (rel[2] == '/' || rel[2] == '\\')
}
