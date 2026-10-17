# Local AI (Ollama, LM Studio)

Every AI feature can run on a model on your own computer instead of a cloud provider. It needs no key and has no daily limit, and nothing you write leaves your machine. The trade-off is that it's slower, and small models are less sharp than the big cloud ones.

## 1. Which version do I need?

First, find out what your computer is:

| System | Where to look | What it means |
| --- | --- | --- |
| **Windows** | Settings → System → About → **System type** | "x64-based" is the usual PC; "ARM-based" is a Snapdragon / Copilot+ PC |
| **Mac** | Apple menu → About This Mac → **Chip** | "Apple M…" is Apple silicon; "Intel" is an Intel Mac |
| **Linux** | Run `uname -m` in a terminal | `x86_64` is x64; `aarch64` is ARM |

Then check how much memory the model can use:
- **Windows and Linux with an NVIDIA or AMD graphics card:** the graphics card's memory (VRAM) matters most. On Windows, look in Task Manager → Performance → GPU → "Dedicated GPU memory". On Linux with NVIDIA, run `nvidia-smi`.
- **Apple silicon Macs:** memory is shared, so the Mac's total memory counts (About This Mac → Memory). Roughly two-thirds of it is usable for a model.
- **No graphics card** (or an Intel/AMD integrated one): it runs on the processor and your RAM. That works, but slowly.

## 2. Install an AI app

**Ollama** (recommended) runs on every system, works with YT Toolkit with no extra setup, and picks a model's context for each request automatically:

| System | Install |
| --- | --- |
| Windows (x64 or ARM) | Download `OllamaSetup.exe` from [ollama.com/download](https://ollama.com/download) and run it |
| Mac (Apple silicon or Intel) | Download Ollama from [ollama.com/download](https://ollama.com/download) and move it to Applications |
| Linux | `curl -fsSL https://ollama.com/install.sh \| sh` (see [ollama.com/download](https://ollama.com/download)) |

**LM Studio** ([lmstudio.ai](https://lmstudio.ai)) is an alternative with a friendly app for browsing models. In LM Studio, open the **Developer** tab and **start the server**. When you load a model, set its **context length** to at least 16384 (32768 is better), because YT Toolkit can't change it from the extension.

Any other server that speaks the OpenAI API on this computer (llama.cpp's `llama-server`, Jan…) works the same way as LM Studio.

## 3. Pick a model for your memory

| Memory for the model | Try | Notes |
| --- | --- | --- |
| 4–6 GB VRAM, or 8 GB RAM | `qwen3.5:4b` (3.4 GB) | Fast on a small graphics card, and it can see thumbnails. A good first model. |
| 8–12 GB VRAM, or a 16 GB Mac | `qwen3.5:9b` (6.6 GB) | Noticeably better at writing. On a 6 GB card it partly runs on the processor and is about 4× slower. |
| 16–24 GB VRAM, or a 32 GB+ Mac | A larger model (around 14–30B) | Closer to cloud quality. Check the [Ollama library](https://ollama.com/library) for current ones. |

Get a model with Ollama by running, in a terminal (Command Prompt or PowerShell on Windows):

```
ollama pull qwen3.5:4b
```

Models change quickly. These are good picks as of late 2026, but the [Ollama library](https://ollama.com/library) shows what's current. Prefer models marked **vision** (they can judge thumbnails) and **tools** (they're usually better at the structured answers YT Toolkit asks for).

## 4. Connect it

1. **Settings → AI assistant → Provider: Local AI (Ollama, LM Studio…)**.
2. **Server address:** `http://localhost:11434` for Ollama, `http://localhost:1234` for LM Studio.
3. Click **Connect**. Chrome asks to let YT Toolkit reach `localhost`, which is only your own computer. The model list loads, and models that can see images are marked "sees images".
4. Pick the model.

**Context window** is how much text the model holds at once: your prompt, the script, the avatars and its answer together. A 10-minute test screening needs about 8k; long transcripts and 20-avatar groups need 16–32k. YT Toolkit sizes each request to what it needs, up to the limit you choose:
- **32k** (the default) covers nearly everything.
- Choose **16k** if the model gets slow or fails to load on a small graphics card.
- If a request needs more than your limit, you get a clear message instead of a silently cut-off prompt. You can raise the limit, use fewer avatars or a shorter script, or switch that one task to a cloud provider.

**Let the model think** is off by default. Models like Qwen can reason before answering, which is sometimes better on hard tasks but much slower. Leave it off for test screenings.

## What to expect

These times were measured on a laptop with a 6 GB RTX 4050:

| Task | `qwen3.5:4b` | `qwen3.5:9b` (partly on the processor) |
| --- | --- | --- |
| Ask your audience (pitch 1 idea to 4 viewers) | ~15 s | ~75 s |
| Test screening, 4 viewers, 7-beat script (3 AI calls) | ~40 s | ~2.5 min |
| Describe a thumbnail | ~20 s | — |

Bigger groups and longer scripts take proportionally longer. Small models follow instructions less precisely than cloud models: test screenings stay usable, but treat their numbers as rougher, and use a cloud model when a decision matters.

## Troubleshooting

- **"Couldn't reach your local AI":** start Ollama (or LM Studio's server) and check the address and port.
- **"refused the extension (403)":** YT Toolkit normally removes the browser's Origin header for local requests, so Ollama accepts them. If it still refuses, reload the extension once. As a last resort, allow extensions in Ollama:
  - **Windows:** System Properties → Environment Variables → new user variable `OLLAMA_ORIGINS` = `chrome-extension://*`, then quit and restart Ollama.
  - **Mac:** `launchctl setenv OLLAMA_ORIGINS "chrome-extension://*"`, then restart Ollama.
  - **Linux (systemd):** `sudo systemctl edit ollama`, add `[Service]` and `Environment="OLLAMA_ORIGINS=chrome-extension://*"`, then `sudo systemctl restart ollama`.
- **"needs about Nk tokens of context":** raise **Context window** in Settings, or make the request smaller.
- **"ran out of room before finishing":** the answer didn't fit. Raise the context window (or, in LM Studio, the model's context length).
- **"can't see images":** pick a vision model, or run the screening without the thumbnail.
- **Very slow:** the model is probably too big for your graphics card (`ollama ps` shows how much runs on the CPU). Use a smaller model, or lower the context window.

## Which companion download do I need?

The optional [video download companion](video-downloads.md) uses the same system types as step 1: `windows-x64` or `windows-arm64`, `macos-arm64` (Apple silicon) or `macos-x64` (Intel), and `linux-x64` or `linux-arm64`.
